import express from 'express';
import fs from 'fs';
import * as util from 'util';
import * as functions from './javascript/scan.js';
import {createHash, load} from 'blake3';
import {JSONFilePreset} from 'lowdb/node'
import {Memory, Low} from 'lowdb'
import path from "path";
const app = express();
import rethinkdbdash from 'rethinkdbdash';

// Create a connection
let r = rethinkdbdash({
  servers: [
    {
      host: '192.168.1.2', // replace with your host
      port: 28015 // replace with your port
    }
  ],
  db: 'test' // replace with your database name
});

async function processFiles(files) {
  for (const value of files.values()) {
    if (value.length > 1) {
      const paths = [];
      for (const element of value) {
        paths.push(element.path[0]);
      }
      const hashes = await hashFilesSequentially(paths);
      for (const element of value) {
        element.hash = hashes.get(path.join(...element.path[0]));
      }
    }
  }
}

async function hashFilesSequentially(filePaths) {
  filePaths = filePaths.map(filePath => path.join(...filePath));
  await load();
  const streams = filePaths.map(filePath => fs.createReadStream(filePath, {
    highWaterMark: 1024 * 1024
  }));
  const hashes = new Map();
  filePaths.forEach((filePath, i) => {
    hashes.set(filePath, createHash());
  });
  let done = Array(filePaths.length).fill(false);
  let iteration = 0;
  let hashFrequency = new Map();
  while (!done.every(Boolean)) {
    await Promise.all(streams.map((stream, i) => new Promise(resolve => {
      let previousHash = hashes.get(filePaths[i]).digest('hex');
      if (hashFrequency.get(previousHash) === 1) {
        console.debug('The current hash for ' + filePaths[i] + ' is unique. Further hashing not needed.');
        done[i] = true;
      }
      if (done[i]) {
        resolve();
      } else {
        stream.once('readable', () => {
          let chunk = stream.read();
          if (chunk !== null) {
            hashes.get(filePaths[i]).update(chunk);
            let digest = hashes.get(filePaths[i]).digest('hex');
            hashFrequency.set(digest, (hashFrequency.get(digest) || 0) + 1);
            resolve();
          } else {
            console.debug('No more data to read from ' + filePaths[i] + '.');
            done[i] = true;
            resolve();
            console.debug('   done[i] = ' + done[i]);
            if (stream.readableEnded) {
              stream.emit('readable');
            }
          }
        });
      }
    })));
    console.debug("======================================")
    console.debug(`Iteration ${++iteration}: ${Array.from(hashes, ([filePath, hash]) => `${filePath}: ${hash.digest('hex')}`).join(', ')}`);
    console.debug("======================================")
  }
  return new Map(Array.from(hashes, ([filePath, hash]) => [filePath, hash.digest('hex')]));
}

async function saveMapToFile(map, filePath) {
  const mapObject = Object.fromEntries(map);
  const db = await JSONFilePreset(filePath, mapObject)
  await db.write()
}

app.get("/scan", async () => {
  const db = new Low(new Memory(), {})
  console.log(db);
  //const files = functions.getAllFiles(settings.include[0])
  const files = functions.getAllFiles('/mnt/user/downloads');
  //console.log('\x1b[1A' + '\x1b[20G' + 'done.');
  await processFiles(files);
  //console.log(files);
  await saveMapToFile(files, "./files.json")
});

app.get("/test", async () => {
  let user = {
    name: 'John Doe',
    email: 'john.doe@example.com',
    age: 30
  };
  await r.table('users').insert(user).run();
});

if (!process.argv.includes('--debug')) {
  console.debug = function() {}
}
const PORT = 3000;
const settings = functions.getSettings();
console.log(util.inspect(settings, false, null, true /* enable colors */ ));
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});