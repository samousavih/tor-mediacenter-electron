// Import Electron modules
import { app, BrowserWindow, ipcMain, globalShortcut } from 'electron';
import fs from 'fs';
import path from 'path';
import puppeteer from 'puppeteer';
import WebTorrent from 'webtorrent';
import dotenv from 'dotenv';
import cp from 'child_process';
import vlcCommand from 'vlc-command';
import { Remote } from 'hdmi-cec'


dotenv.config();

const config = {
    omdb: {
        apiKey: process.env.OMDB_API_KEY,
    }
};


let mainWindow;
const __dirname = path.dirname(new URL(import.meta.url).pathname);
const TORRENT_FILE_PATH = path.join(__dirname, "torrents.json");
const MOVIE_CACHE_FILE = path.join(__dirname, "movies.json");
const pirateBayUrls = [
    "https://thepiratebay.org/top/201",
    "https://thepiratebay.org/top/207",
    "https://thepiratebay.org/top/202",
    "https://thepiratebay.org/top/212"
];
const TOR_PROXY_ARGS = [
    "--proxy-server=socks5://127.0.0.1:9050",
    "--no-sandbox",
];

const STREAMING_PORT = 8080;
const TIMEOUT = 240 * 1000;
const STREAMING_HOST = "localhost";

const MAX_RETRIES = 3;
const RETRY_DELAY = 2000; // 2 seconds

// HDMI-CEC Integration
var remote = new Remote();

// When any button is pressed on the remote, we receive the event:
remote.on('keypress', function (evt) {
    handleRemoteInput(evt.key);
    console.log('user pressed the key "' + evt.key + '" with code "' + evt.keyCode + '"');
});

let currentFocusIndex = 0;
const GRID_COLUMNS = 5

function handleRemoteInput(key) {
    const movies = Object.values(loadMovieCache());
    const gridSize = movies.length;

    switch (key) {
        case 'up':
        case 'up_arrow':
            currentFocusIndex = Math.max(0, currentFocusIndex - GRID_COLUMNS);
            break;
        case 'down':
        case 'down_arrow':
            currentFocusIndex = Math.min(gridSize - 1, currentFocusIndex + GRID_COLUMNS);
            break;
        case 'left':
        case 'left_arrow':
            currentFocusIndex = Math.max(0, currentFocusIndex - 1);
            break;
        case 'right':
        case 'right_arrow':
            currentFocusIndex = Math.min(gridSize - 1, currentFocusIndex + 1);
            break;
        case 'enter':
        case 'select':
            selectMovie(movies[currentFocusIndex]);
            return;
        default:
            console.log('Unhandled key:', key);
            return;
    }


    focusMovie(currentFocusIndex);
    ensureMovieInView(currentFocusIndex);
}

function focusMovie(index) {
    mainWindow.webContents.send('focus-movie', index);
}

function selectMovie(movie) {
    mainWindow.webContents.send('select-movie', movie.torrentLink);
}

function ensureMovieInView(index) {
    mainWindow.webContents.send('scroll-to-movie', index);
}

const cleanMovieName = (torrentName) => {
    // Regular expressions to match and remove specific patterns
    const yearRegex = /\b(19|20)\d{2}\b/; // Match years
    const resolutionRegex = /\b(480p|576p|720p|1080p|2160p|4k|HDRip|WEBRip|BluRay|BDRip|BrRip|DVDRip|WEB-DL|WEB|HDTV|HD)\b/gi;
    const codecRegex = /\b(x264|x265|HEVC|H\.264|AVC|AAC|DTS|DTS-HD|DDP5\.1|DD5\.1|AC3|XviD|5\.1|Dual|Audio|X26|H264|DD2)\b/gi;
    const sourceRegex = /\b(YIFY|RARBG|EVO|TGx|BONE|GalaxyRG|MgB|LAMA|WORLD|ION10|ORBS|AMZN|GalaxyR|RUBik|MeGusta|mSD|threeixtyp|Mkvking|WEBR|SSN|Will1869|MA|AFG|DiRT)\b/gi;
    const qualityRegex = /\b(10bit|HDR|DualAudio|HC-KOR|UNCUT|REMASTERED|DIRECTORS CUT|iNTERNAL|TORRENTGALAXY|COMPLETE|Vol\s?\d+)\b/gi;
    const additionalInfoRegex = /\b(HBO|Collection|Mega\s?Pack|Pack|ReMux|Best Pictures|Series|Season|Episodes|Compilation)\b/gi;
    const encodingIssueRegex = /[\u00C0-\u00FF]+/gi; // Handle encoding issues (e.g., AmÃ©lie)
    const specialCharsRegex = /[._\(\)\-\[\]]/g; // Match special characters
    const sizeRegex = /\b(\d{3,4}MB|\d+\.\d+GB|\d+GB)\b/; // Match sizes
    const unwantedEndRegex = /[-_.]+$/; // Match unwanted trailing symbols
    const keywordsRegex = /\b(sex comedy|Wi|pseudo|mixed|ETRG|SHITBOX|8BaLLRiPS|Best Pictures|GAF Poke|Compilation)\b/gi;
    const sessionInfoRegex = /\b(Season\s?\d+|S\d{2}|EP\d+|E\d+|S\d+E\d+|Collection|Mega\s?Pack|Movie|Pack)\b/gi;

    // Specific case handling for packs and collections
    const packRegex = /\b(\d+\s?to\s?\d+|S\d{2}\s?to\s?S\d{2}|\d+\s?Movies|Box\s?Set|Mega\s?Pack)\b/gi;

    // Clean the torrent name
    let cleanedName = torrentName
        .replace(yearRegex, "") // Remove year
        .replace(resolutionRegex, "") // Remove resolution
        .replace(codecRegex, "") // Remove codec info
        .replace(sourceRegex, "") // Remove source info
        .replace(qualityRegex, "") // Remove quality info
        .replace(additionalInfoRegex, "") // Remove additional info
        .replace(sizeRegex, "") // Remove sizes
        .replace(keywordsRegex, "") // Remove specific terms
        .replace(packRegex, "") // Remove pack indicators
        .replace(encodingIssueRegex, "") // Fix encoding issues
        .replace(specialCharsRegex, " ") // Replace special characters with spaces
        .replace(unwantedEndRegex, "") // Remove unwanted trailing characters
        .replace(/\s+/g, " ") // Normalize spaces
        .trim(); // Trim leading/trailing spaces

    // Match year if present
    const yearMatch = torrentName.match(yearRegex);
    const year = yearMatch ? yearMatch[0] : null;

    // Extract season and episode info
    const { season, episode } = extractSeasonEpisode(torrentName);

    // Handle collections or series explicitly
    cleanedName = cleanedName.replace(sessionInfoRegex, "").trim();


    // Return cleaned movie name and year
    return { name: cleanedName, searchWord: cleanedName, year, season, episode };
};

const extractSeasonEpisode = (name) => {
    const regex = /(?:[Ss]eason\s?(\d{1,2})|[Ss](\d{1,2}))[^\w]*(?:[Ee]pisode\s?(\d{1,2})|[Ee](\d{1,2}))/;
    const match = name.match(regex);
    if (match) {
        const season = match[1] || match[2];
        const episode = match[3] || match[4];
        return { season, episode };
    }
    return {}; // No match found
};


/// Scrape torrents
const scrapeTorrents = async () => {
    console.log("Checking torrent cache...")
    const torrentCache = loadTorrentCache();
    if (torrentCache.length > 0) {
        console.log("Using torrent cache...")
        return torrentCache;
    }
    console.log("Starting torrent scraping...");
    const browser = await puppeteer.launch({
        headless: true,
        args: TOR_PROXY_ARGS,
        executablePath: '/usr/bin/chromium-browser'
    });

    const page = await browser.newPage();
    page.setDefaultNavigationTimeout(TIMEOUT);

    const torrents = [];

    for (const url of pirateBayUrls) {
        let success = false;

        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
            try {
                console.log(`Scraping: ${url} (Attempt ${attempt})`);
                await page.goto(url, { waitUntil: "domcontentloaded" });
                const pageTorrents = await page.evaluate(() => {
                    const results = [];
                    const nameElements = document.querySelectorAll("span.list-item.item-name.item-title a");
                    const magnetElements = document.querySelectorAll('a[href^="magnet:?"]');
                    nameElements.forEach((nameEl, index) => {
                        if (magnetElements[index]) {
                            results.push({
                                name: nameEl.innerText.trim(),
                                link: magnetElements[index].href,
                            });
                        }
                    });
                    return results;
                });
                torrents.push(...pageTorrents);
                success = true;
                break; // Exit retry loop on success
            } catch (error) {
                console.error(`Error scraping ${url} on attempt ${attempt}: ${error.message}`);
                if (attempt < MAX_RETRIES) {
                    console.log(`Retrying in ${RETRY_DELAY / 1000} seconds...`);
                    await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
                } else {
                    console.error(`Failed to scrape ${url} after ${MAX_RETRIES} attempts.`);
                }
            }
        }

        if (!success) {
            console.log(`Skipping ${url} after multiple failed attempts.`);
        }
    }

    await browser.close();

    // Save torrents to a file
    fs.writeFileSync(TORRENT_FILE_PATH, JSON.stringify(torrents, null, 2), "utf-8");
    console.log(`Scraped ${torrents.length} torrents.`);
    return torrents;
};

// Helper: Load movie cache
const loadMovieCache = () => {
    if (fs.existsSync(MOVIE_CACHE_FILE)) {
        return JSON.parse(fs.readFileSync(MOVIE_CACHE_FILE, "utf-8"));
    }
    return {};
};

const loadTorrentCache = () => {
    if (fs.existsSync(TORRENT_FILE_PATH)) {
        return JSON.parse(fs.readFileSync(TORRENT_FILE_PATH, "utf-8"));
    }
    return {};
};

// Helper: Save movie cache
const saveMovieCache = (cache) => {
    fs.writeFileSync(MOVIE_CACHE_FILE, JSON.stringify(cache, null, 2), "utf-8");
};

// Helper: Fetch movie info from OMDb API
const fetchMovieInfo = async (movieName, year) => {
    const query = `http://www.omdbapi.com/?t=${encodeURIComponent(movieName)}${year ? `&y=${year}` : ""}&apikey=${config.omdb.apiKey}`;
    try {
        const response = await fetch(query);
        const data = await response.json();
        if (data.Response === "True") {
            return data; // Return movie details if found
        } else {
            //console.warn(`OMDb API: No result for "${movieName}" (${year})`);
            return null;
        }
    } catch (error) {
        console.error(`OMDb API error: ${error.message}`);
        return null;
    }
};


// Helper: Process torrents
const processTorrents = async (torrents) => {
    const movieCache = loadMovieCache();

    for (const torrent of torrents) {
        const { name: torrentName, link } = torrent;
        const { searchWord, name, year, season, episode } = cleanMovieName(torrentName);

        // Skip if movie already exists in the cache
        if (movieCache[searchWord]) {
            //console.log(`Using cached data for: ${searchWord}`);
            continue;
        }

        //console.log(`Fetching movie info for: ${searchWord}`);
        const movieInfo = await fetchMovieInfo(searchWord, year);
        if (movieInfo) {
            movieCache[searchWord] = { ...movieInfo, torrentLink: link, season, episode, displayName: name };
            //console.log(`Fetched and cached: ${searchWord}`);
        } else {
            movieCache[searchWord] = { Title: name, torrentLink: link, season, episode };
        }
    }

    saveMovieCache(movieCache);
    console.log("Movie cache updated.");
};

// Create HTML for the movies
const generateMovieHTML = (movies) => {
    return `<!DOCTYPE html>
    <html>
    <head>
        <title>Top Movies</title>
        <style>
            .grid {
                display: grid;
                grid-template-columns: repeat(${GRID_COLUMNS}, 1fr);
                gap: 16px;
                justify-content: center;
            }
            .movie {
                border: 1px solid #ddd;
                border-radius: 8px;
                padding: 8px;
                text-align: center;
                cursor: pointer;
            }
            .movie img {
                width: 100%;
                height: 300px;
                object-fit: cover;
                border-radius: 4px;
            }
            .movie h3 {
                font-size: 16px;
                margin: 8px 0;
            }
            .movie p {
                font-size: 14px;
                color: #555;
            }
            .movie.focused {
                border-color: #007bff;
                box-shadow: 0 0 10px rgba(0, 123, 255, 0.5);
            }
        </style>
         <script>
            window.electronAPI.onFocusMovie((index) => {
                const movies = document.querySelectorAll('.movie');
                movies.forEach((movie, i) => {
                    movie.classList.toggle('focused', i === index);
                });
            });

            window.electronAPI.scrollToMovie((index) => {
                const movie = document.querySelectorAll('.movie')[index];
                if (movie) {
                    movie.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }
            });

            window.electronAPI.onSelectMovie((torrentLink) => {
               window.electronAPI.startTorrent(torrentLink);
            });

            
        </script>
    </head>
    <body>
        <h1>Top Movies</h1>
        <div class="grid">
            ${Object.values(movies).map((movie, index) => `
                <div class="movie ${index === 0 ? 'focused' : ''}" tabindex="${index}" onclick="window.electronAPI.startTorrent('${movie.torrentLink}')">
                    <img src="${!!movie.Poster ? movie.Poster : `file://${__dirname}/placeholder.jpeg`}" alt="${movie.Title}"/>
                    <h3>${movie.Title}</h3>
                    ${!!movie.season ? `<p>Season ${movie.season}, Episode ${movie.episode}</p>` : ''}
                    ${!!movie.imdbRating ? `<p>Rating: ${movie.imdbRating}</p>` : ''}
                </div>
            `).join('')}
        </div>
    </body>
    </html>`;
};

// Electron app setup
app.on('ready', async () => {
    // Add keyboard support
    globalShortcut.register('Up', () => handleRemoteInput('up_arrow'));
    globalShortcut.register('Down', () => handleRemoteInput('down_arrow'));
    globalShortcut.register('Left', () => handleRemoteInput('left_arrow'));
    globalShortcut.register('Right', () => handleRemoteInput('right_arrow'));
    globalShortcut.register('Enter', () => handleRemoteInput('enter'));


    let torrentClient = new WebTorrent();

    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            webSecurity: false,
            preload: path.join(__dirname, 'preload.js')
        },
    });


    const torrents = await scrapeTorrents();
    if (torrents.length > 0) {
        await processTorrents(torrents);
    }

    const movies = loadMovieCache();
    const htmlContent = generateMovieHTML(movies);

    const tempHtmlPath = path.join(app.getPath('userData'), 'movies.html');
    fs.writeFileSync(tempHtmlPath, htmlContent);
    mainWindow.loadFile(tempHtmlPath);

    mainWindow.on('closed', () => {
        mainWindow = null;
        app.quit();
    });

    ipcMain.on('start-torrent', (event, torrentLink) => {
        if (torrentClient) {
            torrentClient.destroy();
        }

        torrentClient = new WebTorrent();
        const instance = torrentClient.createServer()
        instance.server.listen(STREAMING_PORT);

        console.log(`Adding torrent: ${torrentLink}`);
        torrentClient.add(torrentLink, { path: './torrents', destroyStoreOnDestroy: true }, torrent => {
            console.log(`Downloading torrent: ${torrent.name}`);

            const streamingUrls = torrent.files
                .filter(file => file.name.endsWith('.mp4') || file.name.endsWith('.mkv'))
                .map(file => new URL(`http://${STREAMING_HOST}:${STREAMING_PORT}${file.streamURL}`).toString())

            console.log(`Streaming urls: ${streamingUrls}`);


            if (streamingUrls) {
                console.log(`Playing video urls: ${streamingUrls}`);
                playVideo(streamingUrls);
            }

            torrent.on('done', () => {
                console.log(`Finished downloading: ${torrent.name}`);
            });
        });
    });


});

const playVideo = (streamingUrls) => {
    console.log(`Starting video urls: ${streamingUrls}`);

    vlcCommand((err, cmd) => {
        if (err) {
            console.error('Comando VLC non trovato ' + err);
            return;
        }
        const args = ["-f"]
        cp.execFile(cmd, args.concat(streamingUrls), (err, stdout) => {
            if (err) {
                console.error(err);
                return;
            }
            console.log(stdout);
        });
    });
}



app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', () => {
    if (mainWindow === null) {
        app.relaunch();
        app.exit();
    }
});
