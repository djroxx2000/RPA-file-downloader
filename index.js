const puppeteer = require('puppeteer');
const fs = require('fs');

const startLink = 'https://reports.dbtfert.nic.in/mfmsReports/getfarmerBuyingDetail.action';

(async () => {
	// Init puppeteer instance
	const browser = await puppeteer.launch();
	const page = await browser.newPage();
	await page.goto(startLink);

	// Set default download directory
	await page._client.send('Page.setDownloadBehavior', {
		behavior: 'allow',
		// This path must match the WORKSPACE_DIR in Step 1
		downloadPath: __dirname + '/csv',
	});

	// Input state, date and press submit
	await Promise.all([
		page.evaluate(() => {
			let selectState = document.getElementById('parameterStateName');
			selectState.childNodes[11].selected = true;
			let currentState = selectState.childNodes[11].value;
			document.getElementById('parameterFromDate').value = '14/01/2021';
			return currentState;
			// document.getElementsById('parameterToDate').value = '';
		}),
		page.click('input[type=submit]'),
		page.waitForNavigation(),
	])
		.then(async ([currentState, _1, _2]) => {
			// Get all anchor tags with more than 0 records
			let res = await page.evaluate(() => {
				let links = document.getElementsByTagName('a');
				let downloadLinks = [];
				for (let link of links) {
					if (link.href.includes('retailerId') && link.innerText != '0') {
						downloadLinks.push(link.href);
					}
				}
				return downloadLinks;
			});
			// console.log(res);
			for (let link of res) {
				await page.goto(link);
				downloadFile(page, link, currentState, 5);
			}
		})
		.catch((err) => {
			console.log('Unable to select form parameters: ', err.message);
		});

	try {
		await page.waitForNavigation({ waitUntil: 'networkidle2' });
	} catch (error) {
		if (error.name != 'TimeoutError') {
			console.log(error.message);
		}
	}

	await browser.close();
})();

async function downloadFile(page, link, currentState, retryCount) {
	let url = new URL(link);
	let searchParams = url.searchParams;
	let retailerId = searchParams.get('retailerId');
	let quantity = searchParams.get('quantity');
	let filename = `${currentState}-${retailerId}-${quantity}.csv`;

	// receive csv response as raw text
	// credentials: include to enable cookies
	let csvData = await page.evaluate(async () => {
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
