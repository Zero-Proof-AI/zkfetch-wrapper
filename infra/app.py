#!/usr/bin/env python3
import os
import aws_cdk as cdk
from zkfetch_wrapper_stack import ZkFetchWrapperStack

env = cdk.Environment(
    account="940333627479",
    region="us-east-1",
)

app = cdk.App()
ZkFetchWrapperStack(app, "ZkFetchWrapperStack",
    // env=cdk.Environment(account=os.getenv('CDK_DEFAULT_ACCOUNT'), 
    env=env,
    region=os.getenv('CDK_DEFAULT_REGION')),
)

app.synth()