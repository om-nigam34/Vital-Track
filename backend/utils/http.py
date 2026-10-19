"""Small helpers shared by the API routes."""

from flask import jsonify, request


def error(message, status=400):
    return jsonify({"error": message}), status


def json_body():
    """The request's JSON body as a dict. Anything else (missing, invalid, a list) becomes {}."""
    data = request.get_json(silent=True)
    return data if isinstance(data, dict) else {}