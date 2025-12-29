from aws_cdk import (
    Stack,
    CfnOutput,
    aws_ecr_assets as ecr_assets,
)
from constructs import Construct


class ZkFetchWrapperStack(Stack):

    def __init__(self, scope: Construct, construct_id: str, **kwargs) -> None:
        super().__init__(scope, construct_id, **kwargs)

        # Build and push the Docker image to ECR
        docker_image = ecr_assets.DockerImageAsset(
            self,
            "ZkFetchWrapperImage",
            directory="..",  # Path to the directory containing the Dockerfile
            file="Dockerfile",
        )

        # Output the image URI
        CfnOutput(
            self,
            "ImageUri",
            value=docker_image.image_uri,
            description="ECR Image URI for ZK Fetch Wrapper",
        )