import ast
import json
import sys
import os


def _node_to_str(node):
    """Convert an AST node to a string, compatible with Python 3.7+."""
    try:
        return ast.unparse(node)  # Python 3.9+
    except AttributeError:
        if isinstance(node, ast.Name):
            return node.id
        if isinstance(node, ast.Attribute):
            return node.attr
        return None


def extract_parameters(flow_file):
    """
    Parse Parameter(...) class-attribute definitions from a Metaflow flow file using AST.

    Metaflow parameters are class-level attributes assigned to Parameter() calls:
        class MyFlow(FlowSpec):
            alpha = Parameter('alpha', default=0.5, type=float, help='...')

    Uses the ast module (not regex) so multi-line decorators and complex type
    annotations are handled correctly.

    Returns a list of dicts with keys:
        name    (str)               — parameter name passed to CLI as --<name>
        type    (str | null)        — type hint name, e.g. 'float', 'int', 'str'
        default (str|int|float|bool|null) — literal default, or null if none
    """
    with open(flow_file, 'r') as f:
        source = f.read()

    tree = ast.parse(source, filename=flow_file)
    parameters = []

    for node in ast.walk(tree):
        if not isinstance(node, ast.ClassDef):
            continue

        # Only process FlowSpec subclasses
        is_flowspec = any(
            (isinstance(b, ast.Name) and b.id == 'FlowSpec') or
            (isinstance(b, ast.Attribute) and b.attr == 'FlowSpec')
            for b in node.bases
        )
        if not is_flowspec:
            continue

        for stmt in node.body:
            if isinstance(stmt, ast.Assign):
                value = stmt.value
                lhs_targets = stmt.targets
            elif isinstance(stmt, ast.AnnAssign):
                value = stmt.value
                lhs_targets = [stmt.target]
            else:
                continue

            if value is None:
                continue

            # Check that RHS is a call to Parameter (bare name or attribute)
            if not isinstance(value, ast.Call):
                continue
            func = value.func
            is_parameter_call = (
                (isinstance(func, ast.Name) and func.id == 'Parameter') or
                (isinstance(func, ast.Attribute) and func.attr == 'Parameter')
            )
            if not is_parameter_call:
                continue

            # ── Name: first positional arg OR 'name' keyword OR LHS variable ──
            param_name = None
            if value.args:
                first_arg = value.args[0]
                if isinstance(first_arg, ast.Constant):
                    param_name = str(first_arg.value)
            if param_name is None:
                for kw in value.keywords:
                    if kw.arg == 'name' and isinstance(kw.value, ast.Constant):
                        param_name = str(kw.value.value)
                        break
            if param_name is None:
                for t in lhs_targets:
                    if isinstance(t, ast.Name):
                        param_name = t.id
                        break
            if param_name is None:
                continue

            # ── Type hint: 'type' keyword arg ─────────────────────────────────
            type_hint = None
            for kw in value.keywords:
                if kw.arg == 'type':
                    if isinstance(kw.value, ast.Name):
                        type_hint = kw.value.id
                    elif isinstance(kw.value, ast.Attribute):
                        type_hint = _node_to_str(kw.value)
                    elif isinstance(kw.value, ast.Constant):
                        type_hint = str(kw.value.value)
                    break

            # ── Default value: 'default' keyword arg ──────────────────────────
            default_val = None
            for kw in value.keywords:
                if kw.arg == 'default':
                    try:
                        default_val = ast.literal_eval(kw.value)
                    except Exception:
                        default_val = _node_to_str(kw.value)
                    break

            parameters.append({
                'name': param_name,
                'type': type_hint,
                'default': default_val,
            })

    return parameters


try:
    flow_file = os.path.abspath(sys.argv[1])
    result = extract_parameters(flow_file)
    print(json.dumps(result))
except Exception as e:
    print(json.dumps({'error': str(e)}))
    sys.exit(1)
