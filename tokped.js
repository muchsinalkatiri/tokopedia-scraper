const puppeteer = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
const fs = require("fs");
const Sequelize = require("sequelize");
const axios = require("axios");
const delayRandom = require("delay-random");
const chalk = require("chalk");

const db = require("./config/Database.js");
const M_keyword_hint = require("./models/KeywordHintModel.js");
const M_product = require("./models/M_ProductModel.js");
const M_product_record = require("./models/M_ProductRecordModel.js");

const ip_proxy = "117.54.4.108:7028";
const username = "matar";
const password = "sto1234";

module.exports = {
  scrape: function (time) {
    (async () => {
      puppeteer.use(StealthPlugin());
      await db.sync({
        alter: true,
      });

      let jam = time;
      if (jam === undefined) {
        return;
      }

      let kata_kunci = await db.query(
        `SELECT id,	keyword, status,	jt.jadwal FROM keyword, 	JSON_TABLE ( jadwal, '$[*]' COLUMNS ( jadwal VARCHAR ( 5 ) PATH '$' ) ) AS jt where jt.jadwal = "${jam}" and status = 1 and mp = "tokped" order by  RAND()`,
        {
          type: Sequelize.QueryTypes.SELECT,
        }
      );

      let total_kw = 0;
      for (let j = 0; j < kata_kunci.length; j++) {
        const url_tokped = "https://www.tokopedia.com/";
        const keyword = kata_kunci[j].keyword;
        const data_hint = [];
        const data_keyword = [];
        const data_record = [];
        let z = 1;

        const browser = await puppeteer.launch({
          headless: false,
          slowMo: 50,
          args: [`--proxy-server=${ip_proxy}`],
        });

        const page = await browser.newPage(); //membuka tab baru di browser

        await page.authenticate({
          username,
          password,
        });
        const client = await page.target().createCDPSession();

        await client.send("Network.setCacheDisabled", {
          cacheDisabled: true,
        });

        while (true) {
          try {
            await page.goto(url_tokped, {
              waitUntil: "load",
            }); //membuka url

            await page.click('input[type="search"]');
            await page.type('input[type="search"]', keyword, {
              delay: 20,
            });
            let xhrCatcher = await page.waitForResponse(
              (r) =>
                r
                  .request()
                  .url()
                  .includes(
                    "https://gql.tokopedia.com/graphql/AutoCompleteQuery"
                  ) && r.request().method() != "OPTIONS"
            );
            let data = await xhrCatcher.json();
            const hint = data[0].data.universe_suggestion.data.items;
            // console.log(hint);
            // return;

            for (let i = 0; i < hint.length; i++) {
              if (hint[i].type == "keyword" && hint[i].title != keyword) {
                let hint_old = await M_keyword_hint.findOne({
                  where: {
                    keyword: keyword,
                    hint: hint[i].title,
                    mp: "tokped",
                  },
                });
                if (hint_old == null) {
                  data_hint.push({
                    keyword: keyword,
                    hint: hint[i].title,
                    mp: "tokped",
                  });
                }
              }
            }
            await M_keyword_hint.bulkCreate(data_hint);

            await page.waitForTimeout(3000);
            await page.keyboard.press("Enter"); // Enter Key

            let xhrCatcher2 = await page.waitForResponse(
              (r) =>
                r
                  .request()
                  .url()
                  .includes(
                    "https://gql.tokopedia.com/graphql/SearchProductQueryV4"
                  ) && r.request().method() != "OPTIONS"
            );
            let data2 = await xhrCatcher2.json();
            const data_product =
              data2[0].data.ace_search_product_v4.data.products;

            for (let i = 0; i < data_product.length; i++) {
              data_keyword.push({
                shopId: data_product[i].shop.shopId,
                itemId: data_product[i].id,
                judul: data_product[i].name,
                lokasi: data_product[i].shop.city,
                toko: data_product[i].shop.name,
                gambar: data_product[i].imageUrl,
                video: data_product[i].customVideoURL,
                url: data_product[i].url,
                mp: "tokped",
                harga: data_product[i].price.replace("Rp", "").replace(".", ""),
                diskon: data_product[i].discountPercentage,
              });

              data_record.push({
                itemId: data_product[i].id,
                jenis: data_product[i].ads.adsId == "" ? "or" : "ads",
                keyword: keyword,
                mp: "tokped",
                rating: data_product[i].rating,
                ulasan: {
                  total: data_product[i].countReview,
                },
              });
            }

            await M_product.bulkCreate(data_keyword, {
              updateOnDuplicate: ["itemId"],
            });
            await M_product_record.bulkCreate(data_record);

            await delayRandom(5000, 10000);
            await browser.close();
            break;
          } catch (e) {
            console.log(chalk.red("ERROR tokopedia lemot ke " + z));
            console.error(chalk.red(e));
            // await page.reload(url_tokped);
            z++;
            continue;
          }
        }
        await delayRandom(20000, 50000); // delay random
        total_kw++;
        console.log(
          chalk.green(`Sukses kata kunci ke ${total_kw} : ${keyword}`)
        );
      }
      axios
        .post(
          "https://api.telegram.org/bot5747843121:AAHbtFtkBNcW0pzhK5LWE3WfYb-W5fkdpgw/sendmessage",
          {
            chat_id: "-751741235",
            text: `${total_kw} kata kunci, jam ${jam}, tokped, sukses`,
          }
        )
        .then((res) => {
          console.log(`statusCode: ${res.status}`);
          // process.exit();
        })
        .catch((error) => {
          console.error(error);
        });
    })().catch((err) => console.error(err));
  },
};
