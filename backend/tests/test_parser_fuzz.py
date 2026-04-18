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


@st.composite
def dataframe_payloads(draw):
    column_count = draw(st.integers(min_value=1, max_value=4))
    row_count = draw(st.integers(min_value=1, max_value=8))
    headers = draw(st.lists(st.text(min_size=0, max_size=12), min_size=column_count, max_size=column_count))
    cell_strategy = st.one_of(
        st.text(max_size=32),
        st.integers(min_value=-10_000, max_value=10_000),
        st.floats(allow_nan=False, allow_infinity=False, width=32),
        st.none(),
    )
    rows = draw(
        st.lists(
            st.lists(cell_strategy, min_size=column_count, max_size=column_count),
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
