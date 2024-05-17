const express = require("express");
const requestPromise = require("request-promise");
const cheerio = require("cheerio");
const cookieJar = requestPromise.jar();
const request = requestPromise.defaults({ jar: cookieJar });
require("dotenv").config();
const fs = require("fs");

const app = express();
app.use(express.json());
const port = 3000;

const requestTimeout = 30000;

async function fetchCSRFToken() {
  const result = await request.get(
    "https://sikep.mahkamahagung.go.id/site/login",
    { timeout: requestTimeout },
  );
  const csrfTokenMatch = result.match(
    /name="csrfParamSikepBackend" value="([^"]*)"/,
  );
  if (!csrfTokenMatch) {
    throw new Error("CSRF token not found");
  }
  return csrfTokenMatch[1];
}

async function login(csrfToken) {
  const loginResponse = await request.post(
    "https://sikep.mahkamahagung.go.id/site/login",
    {
      form: {
        csrfParamSikepBackend: csrfToken,
        "LoginForm[username]": '',
        "LoginForm[password]": '',
        "LoginForm[rememberMe]": 0,
      },
      followAllRedirects: true,
      jar: cookieJar,
    },
  );
  return loginResponse.includes("Selamat datang");
}

async function scrapeData() {
  const url = "https://sikep.mahkamahagung.go.id/laporan/absensi-online";
  const options = {
    url: url,
    headers: {
      Cookie: cookieJar.getCookieString(url),
    },
  };
  const html = await request(options);
  return html;
}

async function scrapeDetailPage(url) {
  const options = {
    url: `https://sikep.mahkamahagung.go.id${url}`,
    headers: {
      Cookie: cookieJar.getCookieString(url),
    },
  };
  try {
    const html = await request(options);
    const $ = cheerio.load(html);
    let detailText = $("th:contains('Status Presensi')").next('td').text().trim();
    return detailText;
  } catch (error) {
    console.error(`Error fetching detail for ${url}:`, error);
    return null;
  }
}

async function processData(html) {
  const $ = cheerio.load(html);
  const jsonData = [];
  const detailPromises = [];

  $("table tr").each((index, element) => {
    if (index !== 0) {
      const cells = $(element).find("td");
      const tanggal = $(cells[1]).text().trim();
      const nip = $(cells[2]).text().trim();
      const nama = $(cells[3]).text().trim();
      // const statusPresensi = $(cells[4]).text().trim();
      const hadir = $(cells[5]).text().trim();
      const siang = $(cells[6]).text().trim();
      const pulang = $(cells[7]).text().trim();
      const alasan = $(cells[8]).find('a.fa.fa-newspaper-o.btn-sm.btn-default').attr('href');
      if (alasan) {
        const detailPromise = scrapeDetailPage(alasan).then(statusPresensi => {
          const apaAlasannya = statusPresensi.replace(/\\n+/g, ' ').trim();
          return { tanggal, nip, nama, statusPresensi: apaAlasannya, hadir, siang, pulang };
        });
        detailPromises.push(detailPromise);
      } else {
        jsonData.push({ tanggal, nip, nama, statusPresensi: 'Tidak Presensi', hadir, siang, pulang });
      }
    }
  });

  const details = await Promise.all(detailPromises);
  jsonData.push(...details);
  return jsonData;
}

app.get("/sikep", async (req, res) => {
  try {
    const csrfToken = await fetchCSRFToken();
    console.log("CSRF Token retrieved...");
    const isLoggedIn = await login(csrfToken);
    if (isLoggedIn) {
      console.log("Logged in successfully...");
      const html = await scrapeData();
      console.log("Data retrieved...");
      const jsonData = await processData(html);
      console.log("Data processed successfully...");

      const telatSikep = jsonData.filter(data => data.hadir >= "08:01");
      const tidakSikepPagi = jsonData.filter(data => data.hadir === "-");
      const sudahSikepPagi = jsonData.filter(data => data.hadir !== "-");
      const tidakSikepPulang = jsonData.filter(data => data.pulang === "-");
      const sudahSikepPulang = jsonData.filter(data => data.pulang !== "-");

      const response = {
        telatSikep,
        tidakSikepPagi,
        sudahSikepPagi,
        tidakSikepPulang,
        sudahSikepPulang,
        author: "https://instagram.com/theazran_"
      };
      res.status(200).json(response);
    } else {
      console.log("Login failed");
      res.status(401).json({
        message: "Login failed",
        author: "https://instagram.com/theazran_"
      });
    }
  } catch (error) {
    console.error("Error:", error.message);
    res.status(500).send({ error: "Internal server error", author: "https://instagram.com/theazran_" });
  }
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});

module.exports = app;