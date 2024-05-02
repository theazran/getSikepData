const express = require("express");
let request = require("request-promise");
const cheerio = require("cheerio");
const cookieJar = request.jar();
request = request.defaults({ jar: cookieJar });
require("dotenv").config();

const app = express();
app.use(express.json());
const port = 3000;

async function fetchCSRFToken() {
  const result = await request.get(
    "https://sikep.mahkamahagung.go.id/site/login",
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
  fs.writeFileSync(
    "cookies.json",
    JSON.stringify(cookieJar.getCookieString(url)),
  );
  const html = await request(options);
  return html;
}

function processData(html) {
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
  const sikepPagi = jsonData.filter((data) => data.hadir === "-");
  const sikepPulang = jsonData.filter((data) => data.pulang === "-");
  const sudahSikepPulang = jsonData.filter((data) => data.pulang !== "-");

  let outputText = "Terlambat Absen SIKEP:\n";
  telatSikep.forEach((data, index) => {
    outputText += `${index + 1}. ${data.nama} - ${data.hadir}\n`;
  });

  outputText += "\n\nDaftar nama yang tidak absen Sikep pagi:\n";
  sikepPagi.forEach((data, index) => {
    outputText += `${index + 1}. ${data.nama}\n`;
  });

  outputText += "\n\nDaftar nama yang tidak absen Sikep pulang:\n";
  sikepPulang.forEach((data, index) => {
    outputText += `${index + 1}. ${data.nama}\n`;
  });

  outputText += "\n\nDaftar nama yang absen Sikep pulang:\n";
  sudahSikepPulang.forEach((data, index) => {
    outputText += `${index + 1}. ${data.nama} - ${data.pulang}\n`;
  });

  return outputText;
}

async function sendNotification(outputText) {
  const options = {
    method: "GET",
    url: `https://notifku.my.id/send?number=000&to=6285255646434@s.whatsapp.net&type=chat&message=${encodeURIComponent(
      outputText,
    )}`,
  };
  return await request(options);
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
      const outputText = processData(html);
      console.log("Data berhasil diolah...");
      await sendNotification(outputText);
      console.log("Notifikasi berhasil dikirim...");
      res.send({
        message: "Data berhasil diambil dan dikirim",
      });
      cookieJar._jar.removeAllCookies(function (err) {
        if (err) {
          console.error("Gagal menghapus cookie:", err);
        } else {
          console.log("Cookie berhasil dihapus.");
        }
      });
    } else {
      console.log("Login gagal");
    }
  } catch (error) {
    console.error("Error:", error.message);
    res.status(500).send({ error: "Internal server error" });
  }
});

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});

module.exports = app;
