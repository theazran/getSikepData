const express = require("express");
let request = require("request-promise");
const cheerio = require("cheerio");
const cookieJar = request.jar();
request = request.defaults({ jar: cookieJar });
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
        "LoginForm[username]": process.env.USERNAME,
        "LoginForm[password]": process.env.PASSWORD,
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
  // fs.writeFileSync("cookies.json", JSON.stringify(cookieJar.getCookieString(url)));
  const html = await request(options);
  return html;
}

function processData(html, res) {
  const $ = cheerio.load(html);
  const jsonData = [];

  $("table tr").each((index, element) => {
    if (index !== 0) {
      const cells = $(element).find("td");
      const tanggal = $(cells[1]).text().trim();
      const nip = $(cells[2]).text().trim();
      const nama = $(cells[3]).text().trim();
      const statusPresensi = $(cells[4]).text().trim();
      const hadir = $(cells[5]).text().trim();
      const siang = $(cells[6]).text().trim();
      const pulang = $(cells[7]).text().trim();

      jsonData.push({
        tanggal,
        nip,
        nama,
        statusPresensi,
        hadir,
        siang,
        pulang,
      });
    }
  });

  const telatSikep = jsonData.filter((data) => data.hadir >= "08:01");
  const tidakSikepPagi = jsonData.filter((data) => data.hadir === "-");
  const tidakSikepPulang = jsonData.filter((data) => data.pulang === "-");
  const sudahSikepPagi = jsonData.filter((data) => data.hadir !== "-");
  const sudahSikepPulang = jsonData.filter((data) => data.pulang !== "-");
  const author = "M Asran";

  res.send(
    JSON.stringify(
      {
        telatSikep,
        tidakSikepPagi,
        sudahSikepPagi,
        tidakSikepPulang,
        sudahSikepPulang,
        author,
      },
      null,
      2,
    ),
  );
}

app.get("/sikep", async (req, res) => {
  try {
    const csrfToken = await fetchCSRFToken();
    console.log("Mendapatkan CSRF Token...");
    const isLoggedIn = await login(csrfToken);
    if (isLoggedIn) {
      console.log("Login berhasil...");
      const html = await scrapeData();
      console.log("Mendapatkan data...");
      const outputText = processData(html, res);
      console.log("Data berhasil diolah...");
      setTimeout(() => {
        cookieJar._jar.removeAllCookies(function (err) {
          if (err) {
            console.error("Gagal menghapus cookie:", err);
          } else {
            console.log("Cookie berhasil dihapus.");
          }
        });
      }, 10000);
    } else {
      console.log("Login gagal");
      res.json({
        status: 401,
        message: "Login gagal",
        author: "M Asran",
      });
    }
  } catch (error) {
    console.error("Error:", error.message);
    res.status(500).send({ error: "Internal server error" });
  }
});

app.listen(port, () => {
  console.log(`Oke gasss... ${port}`);
});

module.exports = app;
