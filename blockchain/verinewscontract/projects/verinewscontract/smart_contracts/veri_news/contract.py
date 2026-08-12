from algopy import ARC4Contract, String
from algopy.arc4 import abimethod


class VeriNews(ARC4Contract):

    @abimethod()
    def store_verification(
        self,
        article_hash: String,
        prediction: String,
        timestamp: String,
    ) -> String:

        return (
            "Stored | Hash: "
            + article_hash
            + " | Prediction: "
            + prediction
            + " | Time: "
            + timestamp
        )





