const puppeteer = require('puppeteer');
const path = require('path');
console.log(__dirname);

let downloadLinks = [];
try {
	(async () => {
		const browser = await puppeteer.launch();
		const page = await browser.newPage();
		await page.goto('https://reports.dbtfert.nic.in/mfmsReports/getfarmerBuyingDetail.action');
		await page._client.send('Page.setDownloadBehavior', {
			behavior: 'allow',
			// This path must match the WORKSPACE_DIR in Step 1
			downloadPath: __dirname,
		});

		await Promise.all([
			page.evaluate(() => {
				let selectState = document.getElementById('parameterStateName');
				selectState.childNodes[11].selected = true;
				document.getElementById('parameterFromDate').value = '14/01/2021';
				// document.getElementById('submit').click();
				// return document;
			}),
			page.click('input[type=submit]'),
			page.waitForNavigation(),
		]).then(async () => {
			// await page.screenshot({ path: 'example.png' });
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
			console.log(res);
			await page.goto(res[0]);
			// await page.goto();
			// await page.waitForResponse('https://reports.dbtfert.nic.in/mfmsReports/report.jsp');
			await page.click('input[type=button]');
			page.on('response', (response) => {
				console.log('in');
				const url = response.request().url();
				console.log(url);
			});
			await page.pdf({ path: './pdf/test.pdf', format: 'A4' });
			await page.waitForNavigation({ waitUntil: 'networkidle2' });

			// await page.screenshot({ path: 'example.png' });
		});
		// console.log(result);

		await browser.close();
	})();
} catch (error) {
	console.log(error);
}
