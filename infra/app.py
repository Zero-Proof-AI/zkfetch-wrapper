#!/usr/bin/env python3
import os
import aws_cdk as cdk
from zkfetch_wrapper_stack import ZkFetchWrapperStack

# Account and region come from the deploying credentials (CDK sets these from
# `aws sts get-caller-identity` and the configured region). Override with
# CDK_DEFAULT_ACCOUNT / CDK_DEFAULT_REGION if needed.
env = cdk.Environment(
    account=os.getenv("CDK_DEFAULT_ACCOUNT"),
    region=os.getenv("CDK_DEFAULT_REGION", "us-east-1"),
)

app = cdk.App()

ZkFetchWrapperStack(app, "ZkFetchWrapperStack", env=env)

app.synth()
