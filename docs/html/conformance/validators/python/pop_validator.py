#!/usr/bin/env python3
"""Independent standard-library POP Core 0.1 conformance validator."""

from __future__ import annotations

import json
import math
import re
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[3]
SUITE_PATH = ROOT / "conformance" / "pop-0.1" / "suite.json"
SEMVER = re.compile(
    r"^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)"
    r"(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$"
)
NAMESPACED_ID = re.compile(r"^[a-z0-9]+(?:[._-][a-z0-9]+)+$")
INTEGRITY = re.compile(r"^sha256-[A-Za-z0-9+/]{43}=$")
SHA256 = re.compile(r"^[0-9a-f]{64}$")
TIMESTAMP = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$")


def main() -> int:
    suite = json.loads(SUITE_PATH.read_text(encoding="utf-8"))
    results: list[dict[str, Any]] = []

    validators = {
        "blueprint": valid_blueprint,
        "evaluation_dataset": valid_dataset,
        "evaluation_result": valid_result,
        "blueprint_package": valid_package,
    }
    for fixture in suite["validation"]:
        actual = validators[fixture["artifact"]](fixture["document"])
        results.append(case_result(fixture["id"], "validation", actual == fixture["expected_valid"]))

    for fixture in suite["comparison"]:
        actual = compare(fixture)
        results.append(case_result(
            fixture["id"], "comparison", actual == fixture["expected_semantic_valid"]
        ))

    for fixture in suite["runtime"]:
        actual = runtime_outcome(fixture)
        results.append(case_result(fixture["id"], "runtime", actual == fixture["expected"]))

    for fixture in suite["capability"]:
        required = fixture["blueprint"].get("requires", [])
        supported = set(fixture["supported_capabilities"])
        missing = next((item for item in required if item not in supported), None)
        actual: dict[str, Any] = {"supported": missing is None}
        if missing is not None:
            actual["missing_capability"] = missing
        results.append(case_result(fixture["id"], "capability", actual == fixture["expected"]))

    passed = sum(1 for item in results if item["passed"])
    report = {
        "schema": "pop.conformance-report/0.1",
        "suite": suite["schema"],
        "specification": suite["specification"],
        "implementation": {"name": "Independent Python validator", "version": "0.1.0"},
        "profile": "runtime",
        "capabilities": [
            "pop.validation.artifacts",
            "pop.evaluation.comparison",
            "pop.runtime.structured-output",
            "pop.runtime.required-capabilities",
        ],
        "summary": {"total": len(results), "passed": passed, "failed": len(results) - passed},
        "cases": results,
        "conformant": passed == len(results),
    }
    print(json.dumps(report, indent=2, ensure_ascii=False))
    return 0 if report["conformant"] else 1


def case_result(identifier: str, group: str, passed: bool) -> dict[str, Any]:
    return {"id": identifier, "group": group, "passed": passed}


def valid_blueprint(value: Any) -> bool:
    required = {"schema", "id", "name", "version", "role", "instructions", "output_schema"}
    optional = {
        "description", "inputs", "input_schema", "examples", "localization",
        "tools", "execution", "requires", "extensions",
    }
    if not exact_object(value, required, optional):
        return False
    if value["schema"] != "pop.blueprint/0.1":
        return False
    if not valid_namespaced_id(value["id"]) or not nonblank(value["name"]):
        return False
    if not valid_semver(value["version"]) or not role_id(value["role"]):
        return False
    if not nonblank(value["instructions"]):
        return False
    if not isinstance(value["output_schema"], dict) or value["output_schema"].get("type") != "object":
        return False
    if "input_schema" in value and not isinstance(value["input_schema"], dict):
        return False
    if "inputs" in value and not valid_input_declarations(value["inputs"]):
        return False
    if "examples" in value and not valid_examples(value["examples"]):
        return False
    if "tools" in value and not unique_ids(value["tools"]):
        return False
    if "requires" in value and not unique_ids(value["requires"]):
        return False
    if "extensions" in value and not namespaced_mapping(value["extensions"]):
        return False
    return True


def valid_dataset(value: Any) -> bool:
    if not exact_object(
        value,
        {"schema", "name", "version", "blueprint", "cases"},
        {"description", "tags", "extensions"},
    ):
        return False
    if value["schema"] != "pop.evaluation-dataset/0.1":
        return False
    if not valid_namespaced_id(value["name"]) or not valid_semver(value["version"]):
        return False
    reference = value["blueprint"]
    if not exact_object(reference, {"id", "version"}, set()):
        return False
    if not valid_namespaced_id(reference["id"]) or not valid_semver(reference["version"]):
        return False
    cases = value["cases"]
    if not isinstance(cases, list) or not cases:
        return False
    return all(valid_dataset_case(item) for item in cases)


def valid_dataset_case(value: Any) -> bool:
    if not exact_object(
        value,
        {"id", "inputs", "expected_output", "comparison"},
        {"description", "tags"},
    ):
        return False
    return (
        case_id(value["id"])
        and isinstance(value["inputs"], dict)
        and isinstance(value["expected_output"], dict)
        and valid_comparison(value["comparison"])
    )


def valid_comparison(value: Any) -> bool:
    if not isinstance(value, dict):
        return False
    mode = value.get("mode")
    if mode in {"exact", "schema"}:
        return set(value) == {"mode"}
    if mode == "fields":
        return set(value) == {"mode", "pointers"} and valid_pointers(value["pointers"])
    if mode == "set":
        return set(value) == {"mode", "pointer"} and json_pointer(value["pointer"])
    if mode == "numeric_tolerance":
        allowed = {"mode", "pointers", "absolute_tolerance", "relative_tolerance"}
        tolerances = [value.get("absolute_tolerance"), value.get("relative_tolerance")]
        return (
            set(value) <= allowed
            and {"mode", "pointers"} <= set(value)
            and valid_pointers(value["pointers"])
            and any(item is not None for item in tolerances)
            and all(item is None or finite_nonnegative(item) for item in tolerances)
        )
    if mode == "custom":
        return (
            {"mode", "comparator"} <= set(value)
            and set(value) <= {"mode", "comparator", "config"}
            and valid_namespaced_id(value["comparator"])
            and ("config" not in value or isinstance(value["config"], dict))
        )
    return False


def valid_result(value: Any) -> bool:
    if not exact_object(
        value,
        {"schema", "dataset", "blueprint", "run", "summary", "cases"},
        {"reproduction", "extensions"},
    ):
        return False
    if value["schema"] != "pop.evaluation-result/0.1":
        return False
    dataset = value["dataset"]
    blueprint = value["blueprint"]
    if not exact_object(dataset, {"name", "version", "sha256"}, set()):
        return False
    if not exact_object(blueprint, {"id", "version", "sha256"}, set()):
        return False
    if not (
        valid_namespaced_id(dataset["name"])
        and valid_semver(dataset["version"])
        and sha256(dataset["sha256"])
        and valid_namespaced_id(blueprint["id"])
        and valid_semver(blueprint["version"])
        and sha256(blueprint["sha256"])
    ):
        return False
    if not valid_run(value["run"]) or not valid_summary(value["summary"]):
        return False
    cases = value["cases"]
    return isinstance(cases, list) and bool(cases) and all(valid_result_case(item) for item in cases)


def valid_run(value: Any) -> bool:
    required = {"id", "started_at", "completed_at", "executor"}
    optional = {"seed", "provider", "model", "sampling"}
    return (
        exact_object(value, required, optional)
        and nonblank(value["id"])
        and timestamp(value["started_at"])
        and timestamp(value["completed_at"])
        and nonblank(value["executor"])
    )


def valid_summary(value: Any) -> bool:
    keys = {"total", "schema_passed", "semantic_passed", "failed", "errors"}
    return (
        exact_object(value, keys, set())
        and integer_at_least(value["total"], 1)
        and all(integer_at_least(value[key], 0) for key in keys - {"total"})
    )


def valid_result_case(value: Any) -> bool:
    required = {"id", "status", "schema_valid", "semantic_valid", "duration_ms"}
    if not exact_object(value, required, {"diagnostics"}):
        return False
    return (
        case_id(value["id"])
        and value["status"] in {"passed", "failed", "error"}
        and boolean_or_none(value["schema_valid"])
        and boolean_or_none(value["semantic_valid"])
        and finite_nonnegative(value["duration_ms"])
    )


def valid_package(value: Any) -> bool:
    if not exact_object(
        value,
        {"schema", "package", "compatibility", "blueprints", "files"},
        {"dependencies", "provenance", "signature", "extensions"},
    ):
        return False
    if value["schema"] != "pop.blueprint-package/0.1":
        return False
    package = value["package"]
    if not exact_object(package, {"name", "namespace", "version", "license"}, set()):
        return False
    if not (
        valid_namespaced_id(package["name"])
        and valid_namespaced_id(package["namespace"])
        and valid_semver(package["version"])
        and nonblank(package["license"])
    ):
        return False
    compatibility = value["compatibility"]
    if not exact_object(compatibility, {"pop"}, {"implementations"}) or not nonblank(compatibility["pop"]):
        return False
    blueprints = value["blueprints"]
    if not isinstance(blueprints, list) or not blueprints:
        return False
    if not all(valid_package_blueprint(item) for item in blueprints):
        return False
    files = value["files"]
    return (
        isinstance(files, dict)
        and bool(files)
        and all(relative_path(path) and integrity(digest) for path, digest in files.items())
    )


def valid_package_blueprint(value: Any) -> bool:
    return (
        exact_object(value, {"id", "version", "path"}, set())
        and valid_namespaced_id(value["id"])
        and valid_semver(value["version"])
        and relative_path(value["path"])
    )


def compare(fixture: dict[str, Any]) -> bool:
    policy = fixture["comparison"]
    expected = fixture["expected_output"]
    actual = fixture["actual_output"]
    mode = policy["mode"]
    if mode == "exact":
        return actual == expected
    if mode == "schema":
        schema = fixture.get("output_schema")
        return validate_json_schema(schema, expected) and validate_json_schema(schema, actual)
    if mode == "fields":
        return all(pointer_value(actual, pointer) == pointer_value(expected, pointer)
                   for pointer in policy["pointers"])
    if mode == "set":
        expected_value = pointer_value(expected, policy["pointer"])
        actual_value = pointer_value(actual, policy["pointer"])
        if not isinstance(expected_value, list) or not isinstance(actual_value, list):
            return False
        return canonical_set(expected_value) == canonical_set(actual_value)
    if mode == "numeric_tolerance":
        for pointer in policy["pointers"]:
            expected_value = pointer_value(expected, pointer)
            actual_value = pointer_value(actual, pointer)
            if not numbers(expected_value, actual_value):
                return False
            permitted = max(
                policy.get("absolute_tolerance", 0),
                abs(expected_value) * policy.get("relative_tolerance", 0),
            )
            if abs(actual_value - expected_value) > permitted:
                return False
        return True
    return False


def runtime_outcome(fixture: dict[str, Any]) -> dict[str, Any]:
    blueprint = fixture["blueprint"]
    if not valid_blueprint(blueprint):
        return {"outcome": "validation_error", "stage": "declaration"}
    input_schema = blueprint.get("input_schema")
    if input_schema is not None and not validate_json_schema(input_schema, fixture["inputs"]):
        return {"outcome": "validation_error", "stage": "input"}
    generated = fixture["generated_output"]
    if not validate_json_schema(blueprint["output_schema"], generated):
        return {"outcome": "validation_error", "stage": "output"}
    return {"outcome": "success", "output": generated}


def validate_json_schema(schema: Any, value: Any) -> bool:
    if not isinstance(schema, dict):
        return False
    kind = schema.get("type")
    if kind == "object":
        if not isinstance(value, dict):
            return False
        if any(key not in value for key in schema.get("required", [])):
            return False
        properties = schema.get("properties", {})
        if schema.get("additionalProperties") is False and any(key not in properties for key in value):
            return False
        if any(key in value and not validate_json_schema(child, value[key])
               for key, child in properties.items()):
            return False
    elif kind == "string" and not isinstance(value, str):
        return False
    elif kind == "number" and not number(value):
        return False
    elif kind == "integer" and not integer(value):
        return False
    elif kind == "boolean" and not isinstance(value, bool):
        return False
    elif kind == "array" and not isinstance(value, list):
        return False
    if "enum" in schema and value not in schema["enum"]:
        return False
    if isinstance(value, str):
        if len(value) < schema.get("minLength", 0):
            return False
        if "pattern" in schema and re.search(schema["pattern"], value) is None:
            return False
    return True


def pointer_value(value: Any, pointer: str) -> Any:
    current = value
    if pointer == "":
        return current
    for token in pointer[1:].split("/"):
        key = token.replace("~1", "/").replace("~0", "~")
        if isinstance(current, dict) and key in current:
            current = current[key]
        elif isinstance(current, list) and key.isdigit() and int(key) < len(current):
            current = current[int(key)]
        else:
            return object()
    return current


def canonical_set(values: list[Any]) -> set[str]:
    return {json.dumps(item, sort_keys=True, separators=(",", ":"), ensure_ascii=False) for item in values}


def exact_object(value: Any, required: set[str], optional: set[str]) -> bool:
    return isinstance(value, dict) and required <= set(value) and set(value) <= required | optional


def nonblank(value: Any) -> bool:
    return isinstance(value, str) and bool(value.strip())


def valid_namespaced_id(value: Any) -> bool:
    return isinstance(value, str) and not value.startswith("pop.") and NAMESPACED_ID.fullmatch(value) is not None


def valid_semver(value: Any) -> bool:
    return isinstance(value, str) and SEMVER.fullmatch(value) is not None


def role_id(value: Any) -> bool:
    return isinstance(value, str) and re.fullmatch(r"^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$", value) is not None


def case_id(value: Any) -> bool:
    return isinstance(value, str) and re.fullmatch(r"^[A-Za-z0-9][A-Za-z0-9._-]*$", value) is not None


def sha256(value: Any) -> bool:
    return isinstance(value, str) and SHA256.fullmatch(value) is not None


def timestamp(value: Any) -> bool:
    return isinstance(value, str) and TIMESTAMP.fullmatch(value) is not None


def integrity(value: Any) -> bool:
    return isinstance(value, str) and INTEGRITY.fullmatch(value) is not None


def relative_path(value: Any) -> bool:
    if not isinstance(value, str) or not value or value.startswith(("/", "\\")):
        return False
    if ":" in value or "\x00" in value:
        return False
    return ".." not in re.split(r"[\\/]", value)


def json_pointer(value: Any) -> bool:
    return isinstance(value, str) and (value == "" or (value.startswith("/") and re.search(r"~(?![01])", value) is None))


def valid_pointers(value: Any) -> bool:
    return isinstance(value, list) and bool(value) and unique_strings(value) and all(json_pointer(item) for item in value)


def unique_ids(value: Any) -> bool:
    return isinstance(value, list) and unique_strings(value) and all(valid_namespaced_id(item) for item in value)


def namespaced_mapping(value: Any) -> bool:
    return isinstance(value, dict) and all(valid_namespaced_id(key) for key in value)


def valid_input_declarations(value: Any) -> bool:
    if not isinstance(value, list):
        return False
    names: list[str] = []
    for item in value:
        if not exact_object(item, {"name"}, {"description", "required", "schema", "default"}):
            return False
        if not isinstance(item["name"], str) or re.fullmatch(r"^[A-Za-z_][A-Za-z0-9_]*$", item["name"]) is None:
            return False
        names.append(item["name"])
    return len(names) == len(set(names))


def valid_examples(value: Any) -> bool:
    return isinstance(value, list) and all(
        exact_object(item, {"inputs", "output"}, {"description"})
        and isinstance(item["inputs"], dict)
        and isinstance(item["output"], dict)
        for item in value
    )


def integer(value: Any) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


def integer_at_least(value: Any, minimum: int) -> bool:
    return integer(value) and value >= minimum


def number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def numbers(first: Any, second: Any) -> bool:
    return number(first) and number(second)


def finite_nonnegative(value: Any) -> bool:
    return number(value) and value >= 0


def boolean_or_none(value: Any) -> bool:
    return value is None or isinstance(value, bool)


def unique_strings(value: list[Any]) -> bool:
    return all(isinstance(item, str) for item in value) and len(value) == len(set(value))


if __name__ == "__main__":
    sys.exit(main())
