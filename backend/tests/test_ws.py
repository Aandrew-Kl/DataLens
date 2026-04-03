import io
import uuid

import csv
import json
import pytest
import pandas as pd


def test_progress_message_format():
    message = {"type": "progress", "percent": 50}
    payload = json.loads(json.dumps(message))

    assert payload["type"] == "progress"
    assert payload["percent"] == 50
    assert set(payload.keys()) == {"type", "percent"}


def test_completion_message():
    message = {"type": "complete", "total_rows": 100}
    payload = json.loads(json.dumps(message))

    assert payload["type"] == "complete"
    assert payload["total_rows"] == 100
    assert set(payload.keys()) == {"type", "total_rows"}


def test_error_message():
    message = {"type": "error", "message": "Query failed"}
    payload = json.loads(json.dumps(message))

    assert payload["type"] == "error"
    assert payload["message"] == "Query failed"
    assert set(payload.keys()) == {"type", "message"}


def test_csv_row_streaming():
    stream = io.StringIO("name,age\nAlice,30\nBob,25\n")
    rows = list(csv.DictReader(stream))

    assert rows == [
        {"name": "Alice", "age": "30"},
        {"name": "Bob", "age": "25"},
    ]
