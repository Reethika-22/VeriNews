import pandas as pd
from sklearn.model_selection import train_test_split
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score
from sklearn.feature_extraction.text import TfidfVectorizer

df = pd.read_csv("fake_news_dataset.csv")

print(df.head())
print(df.info())
print(df.isnull().sum())
print(df.columns)
df = df.dropna()

df["content"] = df["title"] + " " + df["text"]

X = df["content"]
y = df["label"]
X_train, X_test, y_train, y_test = train_test_split(
    X, y,
    test_size=0.2,
    random_state=42
)


vectorizer = TfidfVectorizer(stop_words="english", max_features=5000)

X_train = vectorizer.fit_transform(X_train)
X_test = vectorizer.transform(X_test)

model=LogisticRegression(max_iter=1000)

model.fit(X_train,y_train)

y_pred=model.predict(X_test)
accuracy = accuracy_score(y_test, y_pred)
print("accuracy",accuracy)

import joblib

joblib.dump(model, "model.pkl")
joblib.dump(vectorizer, "vectorizer.pkl")

print("Model saved successfully!")