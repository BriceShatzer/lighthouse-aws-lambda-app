
#! /bin/bash
clear
echo "
Mantle-Lighthouse-Lambda CL-Tool

Please Select Task:
    1. Test index.js - SNS Event (run a custom test of a URL)
    2. Test index.js - SNS Event (run a custom test of a url+feature switch)
    3. Test index.js - SNS Event (run a normal test that saves it's results to Datadog)
    4. Test snsTrigger.js - http.POST Event (run a normal test with a base URL)
    5. Test snsTrigger.js - http.POST Event (base URL + feature switch)
    6. Pack Lambda for deployment - full clean & dep refresh
    7. Pack Lambda for deployment - repackage changed files
    0. exit
"
read -p "Enter selection [0-7] > "

if [[ $REPLY =~ ^[0-7]$ ]]; then
    if [[ $REPLY == 0 ]]; then
        exit
    fi
    if [[ $REPLY == 1 ]]; then
        echo "Test index.js - SNS Event (run a custom test of a URL)"
        echo "if running locally, it will get through all the code, but fail when trying to save to dynamoDB"
        docker run --rm -v "$PWD":/var/task lambci/lambda:nodejs8.10 index.handler "$(cat ./testEvents/index_SNS-base-custom.json)"
        exit
    fi
    if [[ $REPLY == 2 ]]; then
        echo "Test index.js - SNS Event (run a custom test of a url+feature switch)"
        echo "if running locally, it will get through all the code, but fail when trying to save to dynamoDB"
        docker run --rm -v "$PWD":/var/task lambci/lambda:nodejs8.10 index.handler "$(cat ./testEvents/index_SNS-featureSwitch.json)"
        exit
    fi

    if [[ $REPLY == 3 ]]; then
        echo "Test index.js - SNS Event (run a normal test that saves it's results to Datadog)"
        docker run --rm -v "$PWD":/var/task lambci/lambda:nodejs8.10 index.handler "$(cat ./testEvents/index_SNS-datadog.json)"
        exit
    fi
    if [[ $REPLY == 4 ]]; then
        echo "Test snsTrigger.js - http.POST Event (run a normal test with a base URL)"
        echo "if running locally, it will get through all the code, log the message object, but fail when trying publish the SNS notification"
        docker run --rm -v "$PWD":/var/task lambci/lambda:nodejs8.10 snsTrigger.handler "$(cat ./testEvents/snsTrigger_POST-base.json)"
        exit
    fi

    if [[ $REPLY == 5 ]]; then
        echo "Test snsTrigger.js - http.POST Event (custom with feature switch)"
        echo "if running locally, it will get through all the code, log the message object, but fail when trying publish the SNS notification"
        docker run --rm -v "$PWD":/var/task lambci/lambda:nodejs8.10 snsTrigger.handler "$(cat ./testEvents/snsTrigger_POST-customWfeatureSwitch.json)"
        exit
    fi
    if [[ $REPLY == 6 ]]; then
        echo "Pack Lambda for deployment - full clean & dep refresh"
        docker run --rm -v "$PWD":/var/task lambci/lambda:build-nodejs8.10 bash -c "rm -f mantle-lighthouse-lambda.zip && rm -rf node_modules && npm install && zip mantle-lighthouse-lambda.zip -r node_modules index.js package.json"
        exit
    fi
    if [[ $REPLY == 7 ]]; then
        echo "Pack Lambda for deployment - repackage changed files"
        docker run --rm -v "$PWD":/var/task lambci/lambda:build-nodejs8.10 bash -c "rm -f mantle-lighthouse-lambda.zip && zip mantle-lighthouse-lambda.zip -r node_modules index.js package.json"
        exit
    fi
else
    echo "Invalid entry." >&2
    exit 1
fi