from app.services.nlp_service import explain


def test_explain_simple_select() -> None:
    result = explain("SELECT name, age FROM users WHERE age > 25")
    assert "summary" in result
    assert "steps" in result
    assert len(result["steps"]) > 0
    assert "tables" in result
    assert "users" in result["tables"]
    assert "columns" in result


def test_explain_aggregate_query() -> None:
    result = explain("SELECT department, COUNT(*) FROM employees GROUP BY department ORDER BY COUNT(*) DESC LIMIT 5")
    assert any("GROUP" in step.upper() or "Groups" in step for step in result["steps"])
    assert any("LIMIT" in step.upper() or "Limits" in step for step in result["steps"])


def test_explain_join_query() -> None:
    result = explain("SELECT o.id, c.name FROM orders o JOIN customers c ON o.customer_id = c.id")
    assert len(result["tables"]) >= 1
    assert isinstance(result["summary"], str)
    assert len(result["summary"]) > 10
