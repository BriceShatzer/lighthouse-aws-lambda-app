const AWS = require('aws-sdk');
const URL = require('url');
const QUERYSTRING = require('querystring');
const SNStopicARN = 'arn:aws:sns:us-east-2:572049174311:lighthouse-lambda-test-request';
const authKey = 'Lfh81eOs38'
AWS.config.region = 'us-east-2';

exports.handler = function(event, context, callback) {
    const sns = new AWS.SNS();

    switch (event.httpMethod) {
        case 'POST':
            let params = QUERYSTRING.parse(event.body);
            let messageObj = {};
            let urlObj = validateAndParseURL(params);
            messageObj.timestamp = Math.floor(Date.now()/1000);
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
            if(event.queryStringParameters && event.queryStringParameters.auth === authKey){
                const apiURL = 'https://' + event.headers.Host + event.requestContext.path;
                getCustomTestPage(apiURL);
            } else {
                callback(null, {
                    statusCode: '401',
                    body: 'Invalid request. Please provide a valid "auth" value via query string',
                    headers: {
                        'Content-Type': 'text/plain'
                    },
                });
            }
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
                        // Go through the tests and delete the excessively verbose & unused 'details' property from each audit
                        //to limit the possibility of overrunning the AWS's response size limit for lambdas.
                        for (let i = recentTests.length - 1; i >= 0; i--){
                            let dataJSON = JSON.parse(recentTests[i].data);
                            if(dataJSON.audits){
                                dataJSON.audits.forEach((audit)=>{
                                    if(audit.hasOwnProperty('details')){
                                        delete audit.details;
                                    }
                                });
                                recentTests[i].data = dataJSON;
                            }
                        }

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
            let pageHTML = `<html>
<head>
    <title>Kinja Performance Lighthouse - Custom Test Runner</title>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/materialize/1.0.0-rc.2/css/materialize.min.css">
    <script src="https://cdnjs.cloudflare.com/ajax/libs/materialize/1.0.0-rc.2/js/materialize.min.js"></script>
    <style type="text/css">
        .header {text-align: center;}
        .divider {
            margin-top: 5rem;
            margin-bottom: 4rem;
        }
        #recentTests > div {text-align: center;}
        #recentTests .collection {
            margin-top: 2rem;
        }
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
        .collection-item {
            overflow-y: scroll;
            display: flex;
            flex-direction: column;
            cursor: pointer;
            transition: max-height 800ms ease;
        }
        .collection-item {max-height: 100px;}
        .collection-item.expand {
            max-height: 800px;
            flex-flow: column;
            cursor: default;
        }
        .collection-item {border-left:1px dotted transparent;}
        .collection-item.shared-timestamp {border-left-color:cyan;}
        .collection-item.expand .url { font-size: 12px; }
        .label {
            display: flex;
            align-items: center;
        }
        .test-info { flex-basis: 75px; }
        .test-info .type,
        .test-info .timestamp {
            float: left;
        }
       .test-info .variant,
        .test-info .timestamp {
            font-size: 9px;
        }
        .test-info .variant {text-align: center;}
        .test-info .timestamp {
            padding-left: 1em;
        }
        .label .url {
            position: relative;
            top: 0;
            flex: 1;
            padding-left: 15px;
            box-sizing: content-box;
            transition: flex-grow 300ms ease, top 350ms ease;
        }
        .label .url .tested-feature-switch-string{
            color: DarkViolet;
        }
        .expand .label > .url {
            flex-grow: 1;
            text-align: center;
            top: 15px;
            transition: transition: flex-grow 300ms ease, top 100ms ease;
        }
        .collapse-control {
            height: 0;
            overflow: hidden;
            align-self: center;
            font-size:  2em;
            cursor: pointer;
        }
        .expand .collapse-control{
            height: auto;
            overflow: visible;
        }

        .full-audit-to-clipboard {
            cursor: pointer;
        }

        .singular-test {
            display: none;
            text-align: center;
            padding:  30px 0;
            flex: 1 auto;
            flex-wrap: wrap;
        }
        .singular-test div {
            max-width: 30%;
            flex: 1 auto;
        }
        .singular-test .full-audit-to-clipboard {
            max-width: 100%;
            flex: 3 100%;
            padding-top: 30px;
            font-weight: 500;
            opacity: 0.7;
            transition: opacity 300ms linear;
        }
        .singular-test .full-audit-to-clipboard:hover {
            opacity: 1;
        }
        .singular-test .full-audit-to-clipboard span {
            font-size: 2em;
            vertical-align: middle;
        }
        .expand .singular-test {
            display: flex;
            flex-direction: row;
            flex-flow: row wrap;
            justify-content: space-between;

        }
        .comparison-test {
            display: none;
            margin: 30px 0;
            font-size: 12px;
            text-align: center;
        }
        .expand .comparison-test {
            display: table;
        }
        .comparison-test td,
        .comparison-test th {
            text-align: center;
        }
        .comparison-test th {
            padding-bottom: 5px;
        }
        .comparison-test td.full-audit-to-clipboard {
            font-size:  2em;
            vertical-align: middle;
        }
        .comparison-test td.improved {
            color:  green;
        }
        .comparison-test td.declined {
            color:  red;
        }
        .comparison-test tbody tr:last-of-type {
            border-bottom: none;
        }
        .row-title {
            width: 25%;
            font-size:9px;
            text-align: left;
        }
        .collection-item.recent {background-color: #fffbc4;}
        .expand.recent {background-color: transparent;}
        .fixed-action-btn {display: none;}
        .modal-close {
            position: absolute;
            top: 0;
            right: 0.5em;
            padding: 0;
            font-size: 2em;
            line-height: 1;
        }
    </style>
</head>
<body class="container">
<section class="header">
    <h3>Kinja Performance Lighthouse - Custom Test Runner</h3>
    <p>This page will let you perform & retrieve data from custom lighthouse tests</p>
</section>
<section class="start-test">
    <form id="initTest" action="${urlString}" method="POST">
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
<div class="divider"></div>
<section id="recentTests">
    <div>
        <h4> Recently Completed Tests</h4>
        <em>Click a row see more information.</em><br />
        <em>Tests are kept for 3 days before they expire in the database</em><br />
        <em>The most recent tests that were initiated from this browser should be highlighted.</em>
    </div>
    <ul class="collection">
    </ul>
</section>

<div class="fixed-action-btn">
  <a class="btn-floating btn-large modal-trigger" href="#moreInfo" data-target="moreInfo">
    <strong>?</strong>
  </a>
</div>


  <div id="moreInfo" class="modal">
    <a class="btn-flat modal-close modal-trigger" href="#!">&#215;</a>
    <div class="modal-content">
        This will have some info about reading the table

    </div>
  </div>


<script>
    // data injection
    let arrayOfCustomTests = ${JSON.stringify(arrOfRecentTests)}
</script>
<script>
    // Form handler
    let startTestForm = document.getElementById('initTest');
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
            startTestForm.reset();
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
    // Test Review Functionality
    console.dir(arrayOfCustomTests);
    const tableOfTests = document.getElementById('recentTests');

    let lookupTable = {};
    let testCohorts = {};

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

        //setup methods to make life easier...
        arrayOfCustomTests.forEach((customTest) => {
            // create a global lookup table
            lookupTable[customTest.result_id] = customTest.data;
            // group the tests into cohorts based on timestamp/ttl
            testCohorts[customTest.ttl] = testCohorts[customTest.ttl] || [];
            testCohorts[customTest.ttl].push(customTest.result_id);
        });

        arrayOfCustomTests.forEach((testResult) => {
            let cohort = testCohorts[testResult.ttl];
            let timestamp = testResult.result_id.split('-',1)[0];
            let url = testResult.result_id.replace(timestamp + '-', '');
            let urlHtmlString = url;
            let isFeatureSwitchComparisonTest = cohort.length > 3;
            let isSubordinateTest = false;
            let companionTestID;
            let errorInTest;


            let el = document.createElement('li');
            el.setAttribute('data-timestamp', timestamp);
            let typeIcon = '&#127919;'
            let variant = getVariantType(testResult);
            el.classList.add('collection-item');
            if(isFeatureSwitchComparisonTest) {
                // This test is part of a feature switch test, you must find it's matching variant and tie their data together for a comparison
                companionTestID = cohort.find((cohortMemberID) => {
                    return variant === getVariantType(cohortMemberID) &&  cohortMemberID !== testResult.result_id
                });
                typeIcon = '&#9878;';
                if( !companionTestID || !testResult.result_id ) {
                    errorInTest = true;
                    typeIcon = '&#9888;';
                } else if(companionTestID.length > testResult.result_id.length){
                   isSubordinateTest = true;
                }

                //Add highlighting to the urlHtmlString
                let workingArray = (variant !== 'base') ?
                    url.split(/(no3rdparty&|adzone=kinjatest&)/) :
                    url.split(/([?])/);

                workingArray.splice(2,0,'<span class="tested-feature-switch-string">')
                workingArray.push('</span>');
                urlHtmlString = workingArray.join('');
            }

            if(isSubordinateTest){
                //do nothing because we don't need duplicate test elements in the UI :)
            } else {
                if (timestamp == recentTestsTimestamp) {
                    el.classList.add('recent');
                }

                el.innerHTML = '<div class="label">'+
                                    '<div class="test-info">' +
                                        '<div class="type">' + typeIcon + '</div>'+
                                        '<div class="timestamp">' + timestamp.slice(4) + '</div>'+
                                        '<div class="variant">' + variant + '</div>'+
                                    '</div>' +
                                    '<div class="url">' + urlHtmlString + '</div>' +
                                '<div class="collapse-control">&#8965;</div>'+
                               '</div>'

                el.addEventListener('click', (e) => {
                    let clickTarget = event.target;

                    // collapse item if that is all we're trying to do
                    if (clickTarget.classList.contains('collapse-control')){
                        el.classList.remove('expand');
                        return;
                    }

                    // copy JSON result for test to clipboard
                    if (clickTarget.classList.contains('full-audit-to-clipboard')) {
                        if (window.confirm("The full result JSON for tests is really really big. Are you sure you want to copy it to your clipboard?")) {
                            copyAuditToClipboard(clickTarget.getAttribute('data-result_id'));
                        }
                        return
                    }


                    // build test results data if needed
                    if (!el.classList.contains('built')) {
                        let perfValues = getBasePerfData(testResult.result_id);
                        let resultsElement
                        if (isFeatureSwitchComparisonTest && !errorInTest) {
                            let companionTestData = getBasePerfData(companionTestID);
                            let companionTestURL  = companionTestID.replace(/[0-9]*-/,'');
                            //console.log('isFeatureSwitchComparisonTest = true');


                            let table = document.createElement('table');
                            table.classList.add('comparison-test');

                            let tableHead = document.createElement('thead');
                            tableHead.innerHTML = '<thead>'+
                                '<tr>'+
                                    '<th></th>'+
                                    '<th>First Meaningful <br/>Paint (in ms)</th>'+
                                    '<th>Total Page <br/>Weight (in KB)</th>'+
                                    '<th>DOM <br/>node count</th>'+
                                    '<th>Copy result JSON<br/> to Clipboard</th>'+
                                '</tr>'+
                            '</thead>';

                            // create primary row
                            let primaryRow = document.createElement('tr');
                            primaryRow.innerHTML = _generateRowPartial(url, perfValues) +
                                '<td class="full-audit-to-clipboard" data-result_id="' + testResult.result_id + '">&#9112;</td>';

                            // create companion row
                            let companionRow = document.createElement('tr');
                            companionRow.innerHTML = _generateRowPartial(companionTestURL, companionTestData) +
                                '<td class="full-audit-to-clipboard" data-result_id="' + companionTestID + '">&#9112;</td>';

                            // create diff row
                            let diffObj = {
                                firstMeaningfulPaintValue: perfValues.firstMeaningfulPaintValue - companionTestData.firstMeaningfulPaintValue,
                                totalByteWeightValue: perfValues.totalByteWeightValue - companionTestData.totalByteWeightValue,
                                domNodesValue: perfValues.domNodesValue - companionTestData.domNodesValue
                            }

                            let diffRow = document.createElement('tr');
                            diffRow.innerHTML = _generateRowPartial('', diffObj) + '<td></td>';
                            diffRow.querySelectorAll('td').forEach((td)=>{
                                let className;
                                if(td.textContent - 0 < 0) {
                                    className = 'improved';
                                } else if (td.textContent - 0 > 0) {
                                    className = 'declined';
                                }
                                td.classList.add(className);
                            })

                            // create table element
                            let tableBody = document.createElement('tbody');
                            tableBody.append(primaryRow);
                            tableBody.append(companionRow);
                            tableBody.append(diffRow);

                            table.append(tableHead);
                            table.append(tableBody);

                            resultsElement = table;

                            function _generateRowPartial(rowTitle, perfValuesObj){
                                let str =   '<td class="row-title">' + rowTitle+'</td>'+
                                            '<td>' + perfValuesObj.firstMeaningfulPaintValue + '</td>'+
                                            '<td>' + perfValuesObj.totalByteWeightValue + '</td>'+
                                            '<td>' + perfValuesObj.domNodesValue + '</td>'
                                return str
                            }

                        } else {
                            let firstMeaningfulPaintMarkup = '<div> <strong>First Meaningful Paint (in ms)</strong><br/> ' + perfValues.firstMeaningfulPaintValue + '</div>';
                            let totalByteWeightMarkup = '<div> <strong>Total Page Weigth (in KB)</strong><br/> ' + perfValues.totalByteWeightValue + '</div>';
                            let domNodesMarkup = '<div> <strong>DOM node count </strong><br/> ' + perfValues.domNodesValue + '</div>';

                            let copyControl = '<div class="full-audit-to-clipboard" data-result_id="' + testResult.result_id + '"> Copy full result JSON to Clipboard <span>&#9112;</span></div>';

                            resultsElement = document.createElement('div');
                            resultsElement.innerHTML = firstMeaningfulPaintMarkup + totalByteWeightMarkup + domNodesMarkup + copyControl;
                            resultsElement.classList.add('singular-test');
                        }
                        el.append(resultsElement);
                        el.classList.add('built');
                    }

                    // expand the item if we haven't already
                    if (!el.classList.contains('expand')){
                        el.classList.add('expand');
                    }
                });

                el.addEventListener('mouseover', (e) => {
                    let tests = document.querySelectorAll('li.collection-item');
                    let timestamp = el.dataset.timestamp;

                    document.querySelectorAll('li.collection-item.shared-timestamp').forEach((oldSharedTimestampElement) => {
                        oldSharedTimestampElement.classList.remove('shared-timestamp');
                    });

                    document.querySelectorAll('li.collection-item[data-timestamp="'+timestamp+'"]').forEach((newSharedTimestampElement)=>{
                        newSharedTimestampElement.classList.add('shared-timestamp');
                    });

                });

                tableOfTests.querySelector('.collection').appendChild(el);
            }

        });

        // Return the variant using either the "result_id" string or the "testResults" object itself
        function getVariantType(inputValue){
            let result_id;
            if (typeof inputValue === 'object') {
                result_id = inputValue.result_id;
            } else if (typeof inputValue === 'string'){
                result_id = inputValue;
            }
            if (result_id.includes('adzone=kinjatest')){
               return 'adzone=kinjatest';
            } else if (result_id.includes('no3rdparty')){
                return 'no3rdparty';
            } else {
                return 'base'
            }
        }

        // Return an object with the basic perf values we care for a particular test using "result_id"
        function getBasePerfData(targetID){
            let obj = {
                firstMeaningfulPaintValue: Math.floor(_findAudit('first-meaningful-paint').rawValue),
                totalByteWeightValue: Math.floor(_findAudit('total-byte-weight').rawValue / 1024),
                domNodesValue: Math.floor(_findAudit('dom-size').rawValue)
            }
            return obj;

            function _findAudit(id) {
                return lookupTable[targetID].audits.find((audit) => {
                    return audit.id === id
                });
            }
        }

        // Copy all the test data to the clipboard for a particular test using "result_id"
        function copyAuditToClipboard (targetID) {
            let dataToCopy = lookupTable[targetID];
            let textToCopy = JSON.stringify(dataToCopy);
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
        }
    }
    //M.AutoInit(); <-- add back in to use JS powered materialize components
</script>
</body>
</html>
`
            return pageHTML
        }
    }
};
