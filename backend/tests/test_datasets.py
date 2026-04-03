import io
import uuid

import csv
import json
import pytest
import pandas as pd


def test_csv_parsing():
    data = b"name,age\nAlice,30\nBob,25"
    df = pd.read_csv(io.BytesIO(data))

    assert len(df) == 2
    assert df.shape[1] == 2


def test_csv_missing_values():
    data = b"name,age\nAlice,30\nBob,\n,25\n,\n"
    df = pd.read_csv(io.BytesIO(data))

    missing_count = df.isna().sum().sum()
    assert missing_count == 4


def test_unique_file_ids():
    file_ids = {str(uuid.uuid4()) for _ in range(100)}
    assert len(file_ids) == 100


def test_empty_csv():
    data = b"name,age\n"
    df = pd.read_csv(io.BytesIO(data))

    assert len(df) == 0
    assert df.shape[1] == 2
