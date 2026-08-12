import joblib

# Load model and vectorizer
model = joblib.load("model.pkl")
vectorizer = joblib.load("vectorizer.pkl")

news = input("Enter news: ")

news_vector = vectorizer.transform([news])

prediction = model.predict(news_vector)

print("Prediction:", prediction[0])