import logging
import algokit_utils

logger = logging.getLogger(__name__)


def deploy() -> None:
    from smart_contracts.artifacts.veri_news.veri_news_client import (
        StoreVerificationArgs,
        VeriNewsFactory,
    )

    algorand = algokit_utils.AlgorandClient.from_environment()
    deployer = algorand.account.from_environment("DEPLOYER")

    factory = algorand.client.get_typed_app_factory(
        VeriNewsFactory,
        default_sender=deployer.address,
    )

    app_client, result = factory.deploy(
        on_update=algokit_utils.OnUpdate.AppendApp,
        on_schema_break=algokit_utils.OnSchemaBreak.AppendApp,
    )

    if result.operation_performed in [
        algokit_utils.OperationPerformed.Create,
        algokit_utils.OperationPerformed.Replace,
    ]:
        algorand.send.payment(
            algokit_utils.PaymentParams(
                amount=algokit_utils.AlgoAmount(algo=1),
                sender=deployer.address,
                receiver=app_client.app_address,
            )
        )

    response = app_client.send.store_verification(
        args=StoreVerificationArgs(
            article_hash="abc123",
            prediction="Real",
            timestamp="2026-08-06 11:30:00",
        )
    )

    logger.info(
        f"Contract deployed successfully!\n"
        f"App ID: {app_client.app_id}\n"
        f"Response: {response.abi_return}"
    )
