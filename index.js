const lighthouse = require('lighthouse-lambda');
const AWS = require('aws-sdk');
const datadogApi = require('dogapi');
const URL = require('url');


const throttlingDefault = {
// used to overwrite the default throttling behavior that comes out of the box in Lighthouse
    rttMs: 150,
    throughputKbps: 1.6 * 1024,
    requestLatencyMs: 150,
    downloadThroughputKbps: 1.6 * 1024,
    uploadThroughputKbps: 750,
    cpuSlowdownMultiplier: 1,
}
const options = {
    onlyCategories: ['performance'],
    output: 'json',
    throttling: throttlingDefault
};
const dataDogApiKey = '139ba2a32b1934ff3d6b796144ba7f11';
const dataDogAppKey = 'f2f0a1e5cec259b992e31277dab63fc975c20d09';
AWS.config.region = 'us-east-2';


exports.handler = (event, context, callback) => {
    const initMessageID = event.Records[0].Sns.MessageId;
    const initMessageValue = event.Records[0].Sns.Message;
    const initMessageObject = (typeof initMessageValue === "string" ) ? JSON.parse(initMessageValue) : initMessageValue;
    let selectedTestUtility;

    console.log(initMessageObject);
    if (initMessageObject.customTest === 'true' || initMessageObject.customTest === true){
        console.log('in initMessageObject.customTest === true');
        selectedTestUtility = testAndStoreInDynamoDB;
    } else {
        selectedTestUtility = testAndLogWithDatadog;
    }

    multivariantTestRunner(initMessageObject, selectedTestUtility).then(()=>{
        callback(null, 'Lambda initiated by ' + initMessageID + ' successful');
    }).catch((error) => {
        callback(error, 'ERROR: Lambda imitated by ' + initMessageID + ' failed');
    });



    /**
     * Controller function responsible for taking the provide target URL (and any provided feature switch),
     * constructing paths to the various different versions of that target URL we would like to test,
     * and then running those through the provided test functionality.
     * Currently it tests:
     *  - as provided
     *  - ?adzone=kinjatest  sets ads to fill with static testing creative
     *  - ?no3rdparty        removes thirdparty tracking or ad scripts
     *
     * If a feature switch value is provided it will construct an additional set of paths to test.
     * Example:
     *      runTestOn('https://theonion.com', testAndLog, 'new_sidebar')
     * Would result in testAndLog being run with:
     *  - https://theonion.com
     *  - https://theonion.com?adzone=kinjatest
     *  - https://theonion.com?no3rdparty
     *  - https://theonion.com?new_sidebar
     *  - https://theonion.com?new_sidebar&adzone=kinjatest
     *  - https://theonion.com?new_sidebar&no3rdparty
     *
     * @param {object} initObject - an object that used to derive require test parameters, most notably the various URL paths
     * @param {function} testFunctionality - the functionality to run on each path that is constructed
     * @returns {Promise} Promise object that represents the disposition of the provided URL based on all the testing of it's variants
     */
    function multivariantTestRunner(initObject, testFunctionality){
        const targetURL = initObject.url;
        const featureSwitch = initObject.featureSwitch || '';
        const timestamp = initObject.timestamp || Math.floor(Date.now()/1000);

        console.log('in multivariantTestRunner()');
        let testResult = new Promise((resolve,reject) => {
            let tests = [];
            let testPaths = [
                targetURL,
                targetURL + '?adzone=kinjatest',
                targetURL + '?no3rdparty'
            ];

            if (featureSwitch.length > 0){
                testPaths.forEach((testPath) => {
                    let arr = testPath.split('?');
                        arr.splice(1,0,'?');
                        arr.push(featureSwitch);
                    if (arr.length === 4) {
                        arr.splice(3,0,'&');
                    }

                    testPaths.push(arr.join(''));
                })
            }

            testPaths.forEach((testPath) => {
                tests.push(testFunctionality(testPath, timestamp));
            });

            return Promise.all(tests).then((statusOfTests) => {
                statusOfTests.forEach(status => {
                    if (status === false) {
                        reject(new Error('statusOfTests contained a status that returned false'));
                    } else {
                        resolve();
                    }
                });
            }).catch((error) => { reject(error); });
        });

        return testResult;
    }


    /**
     * Uses lighthouse() to collect performance data on the provided url and log it to Datadog
     * @param {string} url - URL to retrieve and log performance data about.
     * @returns {Promise} Promise object indicating if the specified performance data has been retrieved and set to Datadog Successfully.
     */
    function testAndLogWithDatadog(url) {
        datadogApi.initialize({
            api_key: dataDogApiKey,
            app_key: dataDogAppKey
        });

        console.log('in testAndLogWithDatadog()');
        return lighthouse(url, options)
            .then(({ chrome,log,start }) => {
                console.log('in lighthouse.then()');
                return start()
                    .then((results) => {
                        console.log('Received results for ' + url +', now logging it with DataDog.');
                        logResults(results.lhr);

                        return chrome.kill().then(() => Promise.resolve());
                    })
                    .catch((error) => {
                        console.log('looks like an error occurred');
                        console.log(error);
                        console.log('current location: testAndLog > lighthouse.then( start.catch( ✱ ))');

                        return chrome.kill().then(() => Promise.reject(error));
                    })
            }).catch((error) => {
                console.log('looks like an error occurred');
                console.log(error);
                console.log('current location: testAndLog > lighthouse.catch( ✱ )');

                return chrome.kill().then(() => Promise.reject(error));
            });

        function logResults(resultValues) {
            if (resultValues.requestedUrl !== resultValues.finalUrl) {
                console.log(resultValues.requestedUrl);
                console.log('Woah there...looks like a redirect or something funky happened.');
                console.log('We wanted to find ' + resultValues.requestedUrl + ' but ended up at ' + resultValues.finalUrl);
                console.log('current location: testAndLog > logResults(){  ✱  }');
                return false;
            } else {
                const urlObj = URL.parse(url);
                let firstMeaningfulPaintValue = Math.floor(resultValues.audits['first-meaningful-paint'].rawValue);
                let totalByteWeightValue = Math.floor(resultValues.audits['total-byte-weight'].rawValue / 1024);
                let domNodesValue = Math.floor(resultValues.audits['dom-size'].rawValue);
                /* -- available values on results.audits
                 'first-contentful-paint'
                 'first-meaningful-paint'
                 'speed-index'
                 'screenshot-thumbnails'
                 'estimated-input-latency'
                 'time-to-first-byte'
                 'first-cpu-idle'
                 'interactive'
                 'user-timings'
                 'critical-request-chains'
                 'redirects'
                 'mainthread-work-breakdown'
                 'bootup-time'
                 'uses-rel-preload'
                 'uses-rel-preconnect'
                 'font-display'
                 'network-requests'
                 'metrics'
                 'uses-long-cache-ttl'
                 'total-byte-weight'
                 'offscreen-images'
                 'render-blocking-resources'
                 'unminified-css'
                 'unminified-javascript'
                 'unused-css-rules'
                 'uses-webp-images'
                 'uses-optimized-images'
                 'uses-text-compression'
                 'uses-responsive-images'
                 'efficient-animated-content'
                 'dom-size'
                 */
                let metricsToBeLogged = [
                    sendMetric('firstMeaningfulPaint', firstMeaningfulPaintValue), // First Meaningful Paint
                    sendMetric('totalByteWeight', totalByteWeightValue), // Total Byte
                    sendMetric('DOMnodes',domNodesValue) // # of DOM Nodes
                ];

                return Promise.all(metricsToBeLogged);

                function sendMetric(metricName, value) {
                    let fullMetricName = '';
                    fullMetricName += 'mantle.lighthouse.';
                    fullMetricName += urlObj.href
                        .replace(/http[s]:\/\//,'')
                        .replace(/\./g,'_')
                        .replace(/\//g,'')
                        .replace(/=/g,'-')
                        .replace(/\?/g, '--')
                        .replace(/&/g, '.');
                    fullMetricName += '.';
                    fullMetricName += metricName;

                     // //-- local debugging/testing
                     //    console.log(fullMetricName + ': ' + value);
                     //    return Promise.resolve();

                    let sendMetricPromise = new Promise((resolve,reject) => {
                        datadogApi.metric.send(fullMetricName, value, function (error, results) {
                            if (error) {
                                console.log('error in datadogApi.metric.send(' + fullMetricName + ',' + value + ')');
                                console.log(error);
                                reject(new Error('error in sendMetricPromise > '+ fullMetricName));
                            } else {
                                console.log(results);
                                resolve();
                            }
                        })
                    });
                    return sendMetricPromise

                }
            }
        }
    }


    /**
     * Uses lighthouse() to collect performance data on the provided url and then store it to dynamoDB
     * @param {string} url - URL to retrieve and print performance data about.
     * @param {number} timestamp - a UNIX Epoch timestamp used generate a quasi-unique ID value & provide rudimentary datetime sorting
     * @returns {Promise} Promise object indicating if the specified performance data has been retrieved and set to the dynamoDB successfully.
     */
    function testAndStoreInDynamoDB(url, timestamp) {
        const dynamoDB_documentClient = new AWS.DynamoDB.DocumentClient();
        console.log('in testAndStoreInDynamoDB()');

        return lighthouse(url, options)
            .then(({ chrome,log,start }) => {
                console.log('in lighthouse.then()');
                return start()
                    .then((results) => {
                        console.log('Received results for ' + url);

                        let expirationTimestamp = timestamp + 259200;  // 86400 * 3 || seconds in day * # of days
                        let newResultId = timestamp + '-' + url;
                        let auditResults = results.lhr.audits;
                        let metricNames = Object.keys(auditResults);
                        let auditsObj = {};

                        auditsObj['url'] = url;
                        auditsObj['audits'] = [];
                        for (let metricName of metricNames) {
                            if (metricName !== 'screenshot-thumbnails') { // filter out thumbnail audit due to size
                                auditsObj.audits.push(auditResults[metricName]);
                            }
                        }

                        let dataObj = {
                            Item: {
                                result_id: newResultId,
                                data: JSON.stringify(auditsObj),
                                ttl: expirationTimestamp
                            },
                            TableName: 'lighthouse_data'
                        };
                        return dynamoDB_documentClient.put(dataObj, function (error, data) {
                            if (error) {
                                console.log(newResultId + ' - save failed');
                                console.log(error);
                                return chrome.kill().then(() => Promise.reject(error));
                            } else {
                                console.log(newResultId + ' - saved');
                                console.log('result_id: ' + newResultId);
                                return chrome.kill().then(() => Promise.resolve());
                            }
                        });
                    })
                    .catch((error) => {
                        console.log('looks like an error occurred');
                        console.log(error);
                        console.log('current location: testAndStoreInDynamoDB > lighthouse.then( start.catch( ✱ ))');

                        return chrome.kill().then(() => Promise.reject(error));
                    })
            }).catch((error) => {
                console.log('looks like an error occurred');
                console.log(error);
                console.log('current location: testAndStoreInDynamoDB > lighthouse.catch( ✱ )');

                return Promise.reject(error);
            });
    }


    /**
     * Uses lighthouse() to collect performance data on the provided url and output it to the console
     * @param {string} url - URL to retrieve and log performance data about.
     * @returns {Promise} Promise object indicating if the specified performance data has been retrieved and outputted successfully.
     */
    function testAndConsoleLog(url) {
        console.log('in testAndConsoleLog()');
        return lighthouse(url, options)
            .then(({ chrome,log,start }) => {
                console.log('in lighthouse.then()');
                return start()
                    .then((results) => {
                        // use results.lhr for the JS-consumeable output
                        // https://github.com/GoogleChrome/lighthouse/blob/master/typings/lhr.d.ts
                        // use results.report for the HTML/JSON/CSV output as a string
                        // use results.artifacts for the trace/screenshots/other specific case you need (rarer)

                        let auditResults = results.lhr.audits;

                        let metricNames = Object.keys(auditResults);

                        let obj = {};
                        obj['url'] = url;
                        obj['audits'] = [];
                        for (let metricName of metricNames) {

                            if (metricName !== 'screenshot-thumbnails') {
                                obj.audits.push(auditResults[metricName]);
                            }

                        }

                        console.log(obj.audits.length);
                        console.log(JSON.stringify(results.lhr.audits).length);
                        console.log(JSON.stringify(obj).length);

                        return chrome.kill().then(() => Promise.resolve());
                    })
                    .catch((error) => {
                        console.log('looks like an error occurred');
                        console.log(error);
                        console.log('current location: testAndConsoleLog > lighthouse.then( start.catch( ✱ ))');

                        return chrome.kill().then(() => Promise.reject(error));
                    })
            }).catch((error) => {
                console.log('looks like an error occurred');
                console.log(error);
                console.log('current location: testAndConsoleLog > lighthouse.catch( ✱ )');

                return chrome.kill().then(() => Promise.reject(error));
            });
    }
};