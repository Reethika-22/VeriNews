from flask import Flask, request, jsonify
import joblib

app = Flask(__name__)

# Load model and vectorizer
model = joblib.load("model.pkl")
vectorizer = joblib.load("vectorizer.pkl")

@app.route("/")
def home():
    return jsonify({
        "status": "ok",
        "message": "VeriNews AI Service is Running!"
    })

@app.route("/health", methods=["GET"])
def health():
    return jsonify({
        "status": "ok",
        "service": "VeriNews AI Service",
        "model_loaded": model is not None,
        "vectorizer_loaded": vectorizer is not None
    })

@app.route("/predict", methods=["POST"])
def predict():
    try:
        data = request.get_json(silent=True)
        if not data or "text" not in data:
            return jsonify({"error": "Missing 'text' field in request body"}), 400

        news = data["text"]
        if not isinstance(news, str) or not news.strip():
            return jsonify({"error": "News text must be a non-empty string"}), 400

        # Transform text and predict
        news_vector = vectorizer.transform([news])
        raw_prediction = model.predict(news_vector)[0]

        # Normalize prediction output to REAL or FAKE
        pred_str = str(raw_prediction).strip().upper()
        if pred_str in ["1", "REAL", "TRUE"]:
            prediction = "REAL"
        elif pred_str in ["0", "FAKE", "FALSE"]:
            prediction = "FAKE"
        else:
            prediction = pred_str

        return jsonify({
            "prediction": prediction,
            "raw_prediction": str(raw_prediction)
        })

    except Exception as e:
        return jsonify({"error": f"AI prediction error: {str(e)}"}), 500

if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5000, debug=True)