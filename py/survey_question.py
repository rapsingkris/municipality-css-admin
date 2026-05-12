"""
survey_question.py
Flask API backend for the Survey Question builder.
Connects to Supabase for all persistence.

Dependencies:
    pip install flask flask-cors supabase python-dotenv

Environment variables (.env):
    SUPABASE_URL=https://your-project.supabase.co
    SUPABASE_KEY=your-service-role-or-anon-key
"""

import os
from flask import Flask, request, jsonify
from flask_cors import CORS
from supabase import create_client, Client
from dotenv import load_dotenv

load_dotenv()

app = Flask(__name__)
CORS(app)

SUPABASE_URL: str = os.environ.get("SUPABASE_URL", "")
SUPABASE_KEY: str = os.environ.get("SUPABASE_KEY", "")

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)


# ---------------------------------------------------------------------------
# Helper
# ---------------------------------------------------------------------------

def _serialize_survey(survey_row: dict, pages: list) -> dict:
    """Return a clean dict the JS front-end expects."""
    return {
        "id": survey_row["id"],
        "created_at": survey_row.get("created_at"),
        "updated_at": survey_row.get("updated_at"),
        "cards": pages,  # JS calls them "cards"
    }


# ---------------------------------------------------------------------------
# POST /api/save-survey
# Creates a brand-new survey with all pages, questions, and options.
# ---------------------------------------------------------------------------

@app.route("/api/save-survey", methods=["POST"])
def save_survey():
    try:
        body = request.get_json(force=True)
        survey_data: dict = body.get("surveyData", {})
        cards: list = survey_data.get("cards", [])

        if not cards:
            return jsonify({"success": False, "message": "No cards provided"}), 400

        # 1. Insert survey row
        survey_resp = supabase.table("surveys").insert({}).execute()
        survey_id: str = survey_resp.data[0]["id"]

        # 2. Insert pages + questions + options
        _insert_cards(survey_id, cards)

        return jsonify({"success": True, "survey_id": survey_id}), 201

    except Exception as exc:
        return jsonify({"success": False, "error": str(exc)}), 500


# ---------------------------------------------------------------------------
# PUT /api/update-survey/<survey_id>
# Replaces all pages/questions/options for an existing survey (full replace).
# ---------------------------------------------------------------------------

@app.route("/api/update-survey/<survey_id>", methods=["PUT"])
def update_survey(survey_id: str):
    try:
        body = request.get_json(force=True)
        survey_data: dict = body.get("surveyData", {})
        cards: list = survey_data.get("cards", [])

        # Verify survey exists
        existing = supabase.table("surveys").select("id").eq("id", survey_id).execute()
        if not existing.data:
            return jsonify({"success": False, "message": "Survey not found"}), 404

        # Delete all existing pages (cascades to questions and options)
        supabase.table("survey_pages").delete().eq("survey_id", survey_id).execute()

        # Touch updated_at
        supabase.table("surveys").update({"updated_at": "now()"}).eq("id", survey_id).execute()

        # Re-insert pages, questions, options
        _insert_cards(survey_id, cards)

        return jsonify({"success": True, "survey_id": survey_id}), 200

    except Exception as exc:
        return jsonify({"success": False, "error": str(exc)}), 500


# ---------------------------------------------------------------------------
# GET /api/get-survey/<survey_id>
# Returns a single survey with all nested data.
# ---------------------------------------------------------------------------

@app.route("/api/get-survey/<survey_id>", methods=["GET"])
def get_survey(survey_id: str):
    try:
        survey_resp = supabase.table("surveys").select("*").eq("id", survey_id).execute()
        if not survey_resp.data:
            return jsonify({"success": False, "message": "Survey not found"}), 404

        survey_row = survey_resp.data[0]
        pages = _fetch_pages(survey_id)

        return jsonify({"success": True, "survey": _serialize_survey(survey_row, pages)}), 200

    except Exception as exc:
        return jsonify({"success": False, "error": str(exc)}), 500


# ---------------------------------------------------------------------------
# GET /api/get-all-surveys
# Returns all surveys ordered newest-first (summary only, no nested data).
# ---------------------------------------------------------------------------

@app.route("/api/get-all-surveys", methods=["GET"])
def get_all_surveys():
    try:
        resp = supabase.table("surveys").select("id, created_at, updated_at") \
            .order("created_at", desc=True).execute()

        return jsonify({"success": True, "surveys": resp.data}), 200

    except Exception as exc:
        return jsonify({"success": False, "error": str(exc)}), 500


# ---------------------------------------------------------------------------
# DELETE /api/delete-survey/<survey_id>
# ---------------------------------------------------------------------------

@app.route("/api/delete-survey/<survey_id>", methods=["DELETE"])
def delete_survey(survey_id: str):
    try:
        existing = supabase.table("surveys").select("id").eq("id", survey_id).execute()
        if not existing.data:
            return jsonify({"success": False, "message": "Survey not found"}), 404

        # CASCADE handles pages → questions → options
        supabase.table("surveys").delete().eq("id", survey_id).execute()

        return jsonify({"success": True, "deleted_id": survey_id}), 200

    except Exception as exc:
        return jsonify({"success": False, "error": str(exc)}), 500


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _insert_cards(survey_id: str, cards: list) -> None:
    """
    Insert pages, questions, and options for a survey.
    `cards` is the array from the JS payload:
        [
          {
            "type": "multiple-choice" | "likert" | "comment",
            "instruction": str | None,
            "questions": [
              {
                "number": int,
                "text": str,
                "select_type": "radio" | "checkbox",   # multiple-choice only
                "options": ["opt1", "opt2", ...],       # multiple-choice only
                "scale": "5-point",                     # likert only
                "response_type": "open-ended"           # comment only
              },
              ...
            ]
          },
          ...
        ]
    """
    for page_order, card in enumerate(cards, start=1):
        card_type: str = card.get("type", "")
        instruction: str | None = card.get("instruction") or None
        questions: list = card.get("questions", [])

        # Insert page
        page_resp = supabase.table("survey_pages").insert({
            "survey_id": survey_id,
            "page_order": page_order,
            "page_type": card_type,
            "instruction": instruction,
        }).execute()

        page_id: str = page_resp.data[0]["id"]

        # Insert questions
        for q_order, question in enumerate(questions, start=1):
            q_text: str = question.get("text", "").strip()
            if not q_text:
                continue

            q_payload = {
                "page_id": page_id,
                "question_order": q_order,
                "question_text": q_text,
            }

            if card_type == "multiple-choice":
                q_payload["select_type"] = question.get("select_type", "radio")
            elif card_type == "likert":
                q_payload["scale_type"] = question.get("scale", "5-point")
            # comment: no extra fields needed

            q_resp = supabase.table("survey_questions").insert(q_payload).execute()
            question_id: str = q_resp.data[0]["id"]

            # Insert options for multiple-choice
            if card_type == "multiple-choice":
                raw_options: list = question.get("options", [])
                option_rows = [
                    {"question_id": question_id, "option_order": idx + 1, "option_text": opt.strip()}
                    for idx, opt in enumerate(raw_options)
                    if opt.strip()
                ]
                if option_rows:
                    supabase.table("survey_question_options").insert(option_rows).execute()


def _fetch_pages(survey_id: str) -> list:
    """
    Fetch all pages with their questions and options for the given survey.
    Returns data shaped like the `cards` array the JS front-end expects.
    """
    pages_resp = supabase.table("survey_pages").select("*") \
        .eq("survey_id", survey_id).order("page_order").execute()

    result = []
    for page in pages_resp.data:
        page_id = page["id"]

        questions_resp = supabase.table("survey_questions").select("*") \
            .eq("page_id", page_id).order("question_order").execute()

        questions_out = []
        for q in questions_resp.data:
            q_out = {
                "question_text": q["question_text"],
                "select_type": q.get("select_type"),
                "options": [],
            }

            if page["page_type"] == "multiple-choice":
                opts_resp = supabase.table("survey_question_options").select("option_text") \
                    .eq("question_id", q["id"]).order("option_order").execute()
                q_out["options"] = [o["option_text"] for o in opts_resp.data]

            questions_out.append(q_out)

        result.append({
            "card_type": page["page_type"],
            "instruction": page.get("instruction"),
            "questions": questions_out,
        })

    return result


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)