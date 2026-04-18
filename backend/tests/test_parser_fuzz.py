"""Property-based fuzz coverage for backend dataset readers."""

from __future__ import annotations

import io

import pytest

pd = pytest.importorskip("pandas")
pytest.importorskip("openpyxl")
pytest.importorskip("hypothesis")

from hypothesis import given, settings
from hypothesis import strategies as st

from app.services.data_service import _read_dataframe


# openpyxl rejects ASCII control chars in worksheet cells, and pandas.read_excel
# drops rows that serialize as all-empty. Constrain the fuzz alphabet/shape so
# the test targets parser robustness, not xlsx write-time encoding edge cases.
_SAFE_TEXT = st.text(
    alphabet=st.characters(
        blacklist_categories=("Cs",),
        blacklist_characters=[chr(i) for i in range(32) if i not in (9, 10, 13)],
    ),
    min_size=1,
    max_size=32,
).filter(lambda s: s[0] not in {"=", "+", "-", "@"})


@st.composite
def dataframe_payloads(draw):
    column_count = draw(st.integers(min_value=1, max_value=4))
    row_count = draw(st.integers(min_value=1, max_value=8))
    headers = draw(
        st.lists(
            _SAFE_TEXT,
            min_size=column_count,
            max_size=column_count,
            unique=True,
        )
    )
    nonnull_cell = st.one_of(
        _SAFE_TEXT,
        st.integers(min_value=-10_000, max_value=10_000),
        st.floats(allow_nan=False, allow_infinity=False, width=32),
    )
    cell_strategy = st.one_of(nonnull_cell, st.none())

    def build_row(draw_row):
        row = draw_row(
            st.lists(cell_strategy, min_size=column_count, max_size=column_count)
        )
        # Force at least one non-null cell so pandas.read_excel does not drop
        # the row as empty.
        if all(value is None for value in row):
            anchor_idx = draw_row(st.integers(min_value=0, max_value=column_count - 1))
            row[anchor_idx] = draw_row(nonnull_cell)
        return row

    rows = draw(
        st.lists(
            st.composite(build_row)(),
            min_size=row_count,
            max_size=row_count,
        )
    )
    return headers, rows


@given(dataframe_payloads())
@settings(max_examples=40, deadline=None)
def test_read_dataframe_accepts_fuzzed_csv_and_xlsx(payload) -> None:
    headers, rows = payload
    frame = pd.DataFrame(rows, columns=headers)

    csv_buffer = io.BytesIO()
    frame.to_csv(csv_buffer, index=False)
    csv_result = _read_dataframe(csv_buffer.getvalue(), "csv")

    assert not csv_result.empty
    assert len(csv_result.columns) == len(set(csv_result.columns))

    xlsx_buffer = io.BytesIO()
    frame.to_excel(xlsx_buffer, index=False, engine="openpyxl")
    xlsx_result = _read_dataframe(xlsx_buffer.getvalue(), "xlsx")

    assert not xlsx_result.empty
    assert len(xlsx_result.columns) == len(set(xlsx_result.columns))
