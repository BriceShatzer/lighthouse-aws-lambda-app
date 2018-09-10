const AWS = require('aws-sdk');
const URL = require('url');
const QUERYSTRING = require('querystring');
const SNStopicARN = 'arn:aws:sns:us-east-2:572049174311:lighthouse-lambda-test-request';
AWS.config.region = 'us-east-2';

exports.handler = function(event, context, callback) {
    const sns = new AWS.SNS();

    switch (event.httpMethod) {
        case 'POST':
            let params = QUERYSTRING.parse(event.body);
            let messageObj = {};
            let urlObj = validateAndParseURL(params);
            messageObj.timestamp = new Date().getTime();
            messageObj.url = urlObj.href.split('?')[0];
            messageObj.featureSwitch = urlObj.href.split('?')[1] || '';
            if (params.featureSwitch) {
                messageObj.featureSwitch += (messageObj.featureSwitch.length > 0) ? '&' + params.featureSwitch : params.featureSwitch;
            }
            if (params.customTest && params.customTest === 'true'){
                messageObj.customTest = true;
            }

            publishSNSmessage(messageObj, SNStopicARN);
            break;

        case 'GET':
            const apiURL = 'https://' + event.headers.Host + event.requestContext.path;
            getCustomTestPage(apiURL);
            break;

        default:
            callback('unhandled httpMethod...weird', null);
    }


    /**
     * Uses lighthouse() to collect performance data on the provided url and then store it to dynamoDB
     * @param {object} messageObject - Object containing the various.
     * @param {string} timestamp - a UNIX Epoch timestamp used generate a quasi-unique ID value & provide rudimentary datetime sorting
     */
    function publishSNSmessage(messageObject, ARN) {
        sns.publish({
            Message: JSON.stringify(messageObject),
            TopicArn: ARN
        }, function (err, data) {
            if (err) {
                console.log(err.stack);
                callback(null, {
                    statusCode: '520',
                    body: 'error occurred',
                    headers: {
                        'Content-Type': 'text/plain'
                    },
                });
            }
            console.log('push sent');
            console.log(JSON.stringify(messageObject));
            console.log(data);

            callback(null, {
                statusCode: '200',
                body: JSON.stringify(messageObject),
                headers: {
                    'Content-Type': 'application/json'
                }
            });
        });
    }

    /**
     * Parse and validate the URL provided to the service
     * @param {object} paramsObj - a parameters object created from parsing the post body
     * @return {object} a parsed url object
     */
    function validateAndParseURL(paramsObj) {
        let urlObj;
        if (!paramsObj.url || paramsObj.url.length === 0) {
            respondWithFailure();
        } else {
            urlObj = URL.parse(paramsObj.url);
            if (!urlObj.protocol || !urlObj.host || !urlObj.href ) {
                respondWithFailure();
            } else {
                return urlObj;
            }
        }

        function respondWithFailure(){
            callback(null, {
                statusCode: '400',
                body: 'Invalid request. Please include a valid URL',
                headers: {
                    'Content-Type': 'text/plain'
                },
            });
        }
    }

    /**
     * Returns a UI page for performing custom tests
     * @param {string} formURL - a string used to define the endpoint the form interacts with
     * @return {string} an html page in string form
     */
    function getCustomTestPage (url){
        const dynamoDB_documentClient = new AWS.DynamoDB.DocumentClient();
        let recentTests = [];
        let scanningProperties = {
            TableName: 'lighthouse_data',
            Limit: 50
        };

        getTestsAndReturnPage();

        function getTestsAndReturnPage (LastEvaluatedKey) {
            if (LastEvaluatedKey) {
                scanningProperties.ExclusiveStartKey = LastEvaluatedKey;
            }

            dynamoDB_documentClient.scan(scanningProperties, function(error, data) {
                if (error) {
                    console.log('issue occurred in getRecentCustomTests() >  dynamoDB_documentClient.scan()');
                } else {
                    if (data.Items.length) {
                        recentTests.push.apply(recentTests, data.Items);
                    }
                    if (data.LastEvaluatedKey) {
                        getTestsAndReturnPage(data.LastEvaluatedKey);
                    } else {
                        callback(null, {
                            statusCode: '200',
                            body: generatePageHTML(url, recentTests),
                            headers: {
                                'Content-Type': 'text/html'
                            }
                        });
                    }
                }
            });
        };

        function generatePageHTML(urlString,arrOfRecentTests) {
            let pageHTML = `
<html>
<head>
    <title>Kinja Performance Lighthouse - Custom Test Runner</title>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/materialize/1.0.0-rc.2/css/materialize.min.css">
    <script src="https://cdnjs.cloudflare.com/ajax/libs/materialize/1.0.0-rc.2/js/materialize.min.js"></script>

    <style type="text/css">
        .header {text-align: center;}
        #recentTests div {text-align: center;}
        form {
            max-width: 60%;
            min-width: 480px;
            margin-left: auto;
            margin-right: auto;
            display: flex;
            flex-direction: column;
        }
        input[name="customTest"] {display:none;}
        input[type="submit"] {
            align-self: flex-end;
        }
        tbody td {cursor: pointer;}
        tr > * + * {padding-left: 15px;}
        .recent {background-color: #fffbc4;}

    </style>
</head>
<body class="container">
<section class="header">
    <h3>Kinja Performance Lighthouse - Custom Test Runner</h3>
    <p>This page will let you perform & retrieve data from custom lighthouse tests</p>
</section>
<section class="start-test">
    <form id="initTest" action=${urlString} method="POST">
        <div class="required input-field">
            <label for="url">URL to Test:</label>
            <input type="text" id="url" name="url" required />
            <small>required</small>
        </div>

        <div class="input-field">
            <input type="text" id="featureSwitch" name="featureSwitch" />
            <label for="featureSwitch">Feature Switch:</label>

        </div>
        <input type="text" id="customTest" name="customTest" value="true"  />
        <input type="submit" class="btn" />
    </form>
</section>
<section id="recentTests">
    <div>
        <h4> Recently Completed Tests</h4>
        <em>Click row to copy test result JSON to Clipboard. </em><br />
        <em>Tests that match the parameters of the most recent test that you submitted should highlighted.</em>
    </div>
    <table class="highlight">
        <thead>
        <tr>
            <th>Timestamp</td>
            <th>URL</th>
            </th>
        <tbody>
        </tbody>
        </thead>
    </table>

</section>

<script>

    // Form handler
    var startTestForm = document.getElementById('initTest');
    startTestForm.addEventListener("submit", (e) => {
        e.preventDefault();
    if (startTestForm.featureSwitch.value.includes('?')) {
        M.toast({
            html: 'Test not submitted. Please do not include the "?" in the feature switch field'
        });
    } else {
        ajaxPost(startTestForm, handleFormPost);
    }

    });

    function ajaxPost (form, callback) {
        let url = form.action,
                xhr = new XMLHttpRequest();
        let params = [].filter.call(form.elements, (el)=>{
                    return el.type === "text" && el.value.length>0;
    }).map(function(el) {
            return encodeURIComponent(el.name) + '=' + encodeURIComponent(el.value);
        }).join('&');
        console.log(params);
        xhr.open("POST", url);
        xhr.setRequestHeader("Content-type", "application/x-form-urlencoded");
        xhr.onload = callback.bind(xhr);
        xhr.send(params);
    }
    function handleFormPost(val) {
        let toastMessage;
        if (val.currentTarget.status === 200) {
            let response = JSON.parse(val.currentTarget.response);
            console.log(response);
            document.cookie = 'recentTestsTimestamp='+response.timestamp;
            toastMessage = 'Custom test successfully requested. Please check back here in a few moments for the results. Tests generally take anywhere from 30 - 180 seconds to appear on this page.';

        } else {
            toastMessage = 'It looks like an issue occurred while submitting your test request. Try reloading the page and making sure your URL & feature switch fields are valid';
        }


        M.toast({
            html: toastMessage
        });
    }
</script>

<script>
    let arrayOfCustomTests = ${JSON.stringify(arrOfRecentTests)};
    console.dir(arrayOfCustomTests);
    const tableOfTests = document.getElementById('recentTests');
    let lookupObject = {};

    if (!arrayOfCustomTests.length>0) {
        document.getElementById('recentTests').style.display = 'none';
    } else {
        let recentTestsTimestamp = document.cookie.replace( 'recentTestsTimestamp=', '');

        arrayOfCustomTests.sort(sortByTimestampDecending);
        function sortByTimestampDecending(a,b) {
            let aTimestamp = a.result_id.split('-',1)[0] - 0;
            let bTimestamp = b.result_id.split('-',1)[0] - 0;
            return bTimestamp - aTimestamp
        }

        /*
         arrayOfCustomTests.forEach((customTest)=>{
         lookupObject[customTest.result_id] = customTest.data;
         });
         */
        arrayOfCustomTests.forEach((testResult) => {
            let timestamp = testResult.result_id.split('-',1)[0];
        let url = testResult.result_id.replace(timestamp + '-', '');
        let el = document.createElement('tr');
        debugger;
        if (timestamp == recentTestsTimestamp) {
            el.classList.add('recent');
        }
        el.innerHTML = '<td>' + timestamp + '</td><td>' + url + '</td>';
        el.addEventListener('click', () => {
            // copy JSON result for test to clipboard
            let textToCopy = JSON.stringify(testResult);
        let txt = document.createTextNode(textToCopy);
        document.body.appendChild(txt);
        try {
            if (document.body.createTextRange) {
                let d = document.body.createTextRange();
                d.moveToElementText(txt);
                d.select();
                document.execCommand('copy');
            } else {
                let d = document.createRange();
                d.selectNodeContents(txt);
                window.getSelection().removeAllRanges();
                window.getSelection().addRange(d);
                document.execCommand('copy');
                window.getSelection().removeAllRanges();
            }
            txt.remove();

            M.toast({
                html: 'JSON for ' + url + ' copied successfully',
                displayLength : 2500
            });
        } catch (error) {
            M.toast({
                html: 'An error occured while copying the JSON for ' + url,
                displayLength : 2500
            });
        }
    });

        tableOfTests.querySelector('tbody').appendChild(el);
    });
        /*
         Object.keys(lookupObject).forEach((key) => {
         let timestamp = key.split('-',1);
         let url = key.replace(timestamp + '-', '');
         let el = document.createElement('tr');
         if (timestamp == recentTestsTimestamp) {
         el.classList.add('recent');
         }
         el.innerHTML = '<td>' + timestamp + '</td><td>' + url + '</td>';
         el.addEventListener('click', () => {
         // copy JSON result for test to clipboard
         let textToCopy = JSON.stringify(lookupObject[key]);
         let txt = document.createTextNode(textToCopy);
         document.body.appendChild(txt);
         try {
         if (document.body.createTextRange) {
         let d = document.body.createTextRange();
         d.moveToElementText(txt);
         d.select();
         document.execCommand('copy');
         } else {
         let d = document.createRange();
         d.selectNodeContents(txt);
         window.getSelection().removeAllRanges();
         window.getSelection().addRange(d);
         document.execCommand('copy');
         window.getSelection().removeAllRanges();
         }
         txt.remove();

         M.toast({
         html: 'JSON for ' + url + ' copied successfully',
         displayLength : 2500
         });
         } catch (error) {
         M.toast({
         html: 'An error occured while copying the JSON for ' + url,
         displayLength : 2500
         });
         }
         });

         tableOfTests.querySelector('tbody').appendChild(el);
         });
         */
    }

</script>
</body>
</html>
`
            return pageHTML
        }
    }
};
