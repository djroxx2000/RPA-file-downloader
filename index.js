const puppeteer = require('puppeteer');
const fs = require('fs');

const startLink = 'https://reports.dbtfert.nic.in/mfmsReports/getfarmerBuyingDetail.action';

const downloadDir = __dirname + '/csv';
if (!fs.existsSync(downloadDir)) {
	fs.mkdirSync(downloadDir);
}

const readline = require('readline');
const rl = readline.createInterface({
	input: process.stdin,
	output: process.stdout,
});

let dateFrom, dateTo;
rl.question('Enter Date to Start Download from: ', function (fromDate) {
	rl.question('Enter Date to Start Download to: ', function (toDate) {
		dateFrom = fromDate;
		dateTo = toDate;
		rl.close();
	});
});
rl.on('close', () => {
	checkDate();
});

function checkDate() {
	const pattern = /^(?:(?:31(\/|-|\.)(?:0?[13578]|1[02]))\1|(?:(?:29|30)(\/|-|\.)(?:0?[13-9]|1[0-2])\2))(?:(?:1[6-9]|[2-9]\d)?\d{2})$|^(?:29(\/|-|\.)0?2\3(?:(?:(?:1[6-9]|[2-9]\d)?(?:0[48]|[2468][048]|[13579][26])|(?:(?:16|[2468][048]|[3579][26])00))))$|^(?:0?[1-9]|1\d|2[0-8])(\/|-|\.)(?:(?:0?[1-9])|(?:1[0-2]))\4(?:(?:1[6-9]|[2-9]\d)?\d{2})$/;

	if (pattern.test(dateFrom) && pattern.test(dateTo)) {
		// Puppeteer stuff
		(async () => {
			// Init puppeteer instance
			const browser = await puppeteer.launch();
			const page = await browser.newPage();
			const downloadPage1 = await browser.newPage();
			const downloadPage2 = await browser.newPage();
			try {
				await page.goto(startLink);
			} catch (error) {
				if (error.message.includes('ERR_NAME_NOT_RESOLVED')) {
					console.log('No internet connection...exiting');
					process.exit();
				}
			}

			// Set default download directory
			try {
				await page._client.send('Page.setDownloadBehavior', {
					behavior: 'allow',
					// This path must match the WORKSPACE_DIR in Step 1
					downloadPath: downloadDir,
				});
			} catch (error) {
				console.log('Unable to set download directory: ', error.message);
			}

			// Input state, date and press submit
			let states = await page.evaluate(() => {
				let selectState = document.getElementById('parameterStateName');
				let states = [];

				// Replace lower limit with 3, upper limit with selectState.childNodes.length when want all states
				for (let i = 19; i < 25; i += 2) {
					states.push({ state: selectState.childNodes[i].value, index: i });
				}
				return states;
			});
			for (let state of states) {
				console.log('Downloading state data: ', state);
				await page.goto(startLink);
				await Promise.all([
					page.evaluate(
						(state, dateFrom, dateTo) => {
							window.addEventListener('offline', () => {
								return 'offline';
							});
							let selectState = document.getElementById('parameterStateName');
							selectState.childNodes[state.index].selected = true;
							let currentState = state.state;
							document.getElementById('parameterFromDate').value = dateFrom;
							document.getElementById('parameterToDate').value = dateTo;
							return currentState;
						},
						state,
						dateFrom,
						dateTo
					),
					page.click('input[type=submit]'),
					page.waitForNavigation(),
				])
					.then(async ([currentState, _1, _2]) => {
						// Get all anchor tags with more than 0 records
						// let stateDownloadLinks = [];
						// let pageRepeat = false;
						if (currentState == 'offline') {
							console.log('Internet Connection Lost');
						}
						while (true) {
							let result = await page.evaluate(() => {
								let links = document.getElementsByTagName('a');
								let downloadLinks = [];
								let nextURL = '';
								let pageNum = 0;
								for (let link of links) {
									if (link.href.includes('retailerId') && link.innerText != '0') {
										downloadLinks.push(link.href);
									}
									if (link.innerText == 'Next ?') {
										nextURL = link.href;
										let nextURLParams = new URL(nextURL).searchParams;
										pageNum = nextURLParams.get('d-16544-p');
										if (pageNum == '') {
											pageNum = -1;
										}
									}
								}
								if (links.length < 5) {
									pageNum = -1;
								}
								return { downloadLinks, nextURL, pageNum };
							});
							// stateDownloadLinks = [...stateDownloadLinks, ...result.downloadLinks];
							let downCount = 0;
							for (let link of result.downloadLinks) {
								if (downCount % 2 == 0) {
									try {
										await downloadPage1.goto(link);
									} catch (error) {
										console.log('download page redirection error: ', error.message);
									}
									downloadFile(downloadPage1, link, currentState, 5);
								} else {
									try {
										await downloadPage2.goto(link);
									} catch (error) {
										console.log('download page 2 redirection error: ', error.message);
									}
									downloadFile(downloadPage2, link, currentState, 5);
								}
								downCount++;
							}
							if (result.pageNum == -1 || result.nextURL == '') {
								if (result.downloadLinks.length == 0) {
									console.log('No more data for state in given date range');
								}
								break;
							} else {
								await page.goto(result.nextURL);
							}
						}
						// for (let link of stateDownloadLinks) {
						// 	await page.goto(link);
						// 	downloadFile(page, link, currentState, 5);
						// }
					})
					.catch((err) => {
						console.log('Unable to select form parameters: ', err.message);
					});
			}

			try {
				await page.waitForNavigation({ waitUntil: 'networkidle2' });
			} catch (error) {
				if (error.name != 'TimeoutError') {
					console.log(error.message);
				}
			}

			await browser.close();
		})();
	} else {
		console.log('Invalid date format');
	}
}

async function downloadFile(page, link, currentState, retryCount) {
	require('dns').resolve('www.google.com', function (err) {
		if (err) {
			console.log('Waiting for connection...');
		}
	});

	let url = new URL(link);
	let searchParams = url.searchParams;
	let retailerId = searchParams.get('retailerId');
	let quantity = searchParams.get('quantity');
	let filename = `${currentState}-${retailerId}-${quantity}.csv`;

	// receive csv response as raw text
	// credentials: include to enable cookies
	let csvData = await page.evaluate(async () => {
		if (document.getElementsByTagName('input').length == 0) {
			return null;
		}
		try {
			let res = await fetch('https://reports.dbtfert.nic.in/mfmsReports/report.jsp', {
				method: 'GET',
				credentials: 'include',
			});
			return await res.text();
		} catch (error) {
			console.log('Unable to fetch data: ', error.name);
		}
	});

	if (csvData == null) {
		console.log('Link for', filename, 'is empty');
	}

	fs.writeFile(`csv/${filename}`, csvData, 'utf8', function (err) {
		if (err) {
			if (retryCount > 0) {
				console.log(
					'Some error occured - file either not saved or corrupted file saved.Retrying in a while...'
				);
				setTimeout(() => {
					downloadFile(page, link, currentState, retryCount - 1);
				}, 5000);
			} else {
				console.log('Unable to download file after multiple attempts from', link);
			}
		} else {
			console.log(`${filename} saved successfully`);
		}
	});
}
