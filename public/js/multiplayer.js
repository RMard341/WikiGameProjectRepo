const socket = io();

const playerNameInput = document.getElementById('playerName');
const roomCodeInput = document.getElementById('roomCodeInput');
const createRoomBtn = document.getElementById('createRoomBtn');
const joinRoomBtn = document.getElementById('joinRoomBtn');
const startGameBtn = document.getElementById('startGameBtn');
const newGameBtn = document.getElementById('new-game');
const giveUpBtn = document.getElementById('give-up');
const roomSetupSection = document.getElementById('roomSetupSection');

const roomCodeDisplay = document.getElementById('roomCodeDisplay');
const roomStatus = document.getElementById('roomStatus');
const goalTitle = document.getElementById('goal-title');
const currentTitleHeader = document.getElementById('current-title');
const playerList = document.getElementById('playerList');
const setupMessage = document.getElementById('setupMessage');
const articleContent = document.getElementById('article-content');
const scoreEl = document.getElementById('score');
const timerEl = document.getElementById('timer');
const movesEl = document.getElementById('moves');
const articleCountEl = document.getElementById('article-count');

let currentRoomCode = '';
let currentRoom = null;
let mySocketId = '';
let currentLoadedArticle = '';
let timerInterval = null;

socket.on('connect', () => {
    mySocketId = socket.id;
});

function showMessage(message, isError = false) {
    setupMessage.textContent = message;
    setupMessage.className = isError ? 'small text-danger' : 'small text-muted';
}

function getPlayerName() {
    const name = playerNameInput.value.trim();
    return name || 'Player';
}

function getMyPlayer(room) {
    if (!room || !room.players) {
        return null;
    }

    return room.players.find(player => player.id === mySocketId) || null;
}

function getWinner(room) {
    if (!room || !room.winnerId) {
        return null;
    }

    return room.players.find(player => player.id === room.winnerId) || null;
}

function formatTime(totalSeconds) {
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;

    return (minutes < 10 ? '0' + minutes : minutes) + ':' +
           (seconds < 10 ? '0' + seconds : seconds);
}

function calculateScore(player) {
    if (!player) {
        return 1000;
    }

    return Math.max(100, 1000 - (player.moves * 10));
}

function resetArticleView(message = 'Create a room or join a room to begin multiplayer.') {
    currentLoadedArticle = '';
    articleContent.innerHTML =
        '<div class="text-center mt-5">' +
        '<p class="mt-2 text-muted">' + message + '</p>' +
        '</div>';

    currentTitleHeader.innerHTML = 'Current: <span class="text-muted">Not started</span>';
    articleCountEl.textContent = '0 available';
}

function updateStats(room) {
    const myPlayer = getMyPlayer(room);

    movesEl.textContent = myPlayer ? myPlayer.moves : 0;
    scoreEl.textContent = myPlayer ? calculateScore(myPlayer) : 1000;

    if (!room || !room.startedAt || room.status !== 'playing') {
        timerEl.textContent = '00:00';
        return;
    }

    const elapsedSeconds = Math.floor((Date.now() - room.startedAt) / 1000);
    timerEl.textContent = formatTime(elapsedSeconds);
}

function startTimer() {
    stopTimer();

    timerInterval = setInterval(() => {
        if (currentRoom && currentRoom.status === 'playing') {
            updateStats(currentRoom);
        }
    }, 1000);
}

function stopTimer() {
    if (timerInterval) {
        clearInterval(timerInterval);
        timerInterval = null;
    }
}

function updateRoomSetupVisibility(room) {
    if (!room) {
        roomSetupSection.style.display = 'block';
        return;
    }

    if (room.status === 'playing') {
        roomSetupSection.style.display = 'none';
    } else {
        roomSetupSection.style.display = 'block';
    }
}

function updateControlButtons(room) {
    const amIHost = room && room.hostId === mySocketId;
    const inRoom = !!room;
    const isPlaying = room && room.status === 'playing';

    newGameBtn.disabled = !inRoom || !amIHost || isPlaying;
    giveUpBtn.disabled = !inRoom || !isPlaying;
}

function renderPlayers(players, hostId, winnerId) {
    if (!players || players.length === 0) {
        playerList.innerHTML = 'No players yet';
        return;
    }

    playerList.innerHTML = players.map(player => {
        let text = player.name + ' - ' + player.moves + ' move' + (player.moves === 1 ? '' : 's');

        if (player.id === hostId) {
            text += ' (Host)';
        }

        if (player.id === winnerId) {
            text += ' 🏆 Winner';
        } else if (player.finished) {
            text += ' ✅';
        }

        return '<div class="mb-1">' + text + '</div>';
    }).join('');
}

function processWikipediaContent(htmlContent) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlContent, 'text/html');

    removeUnwantedElements(doc);
    processWikiLinks(doc);
    addWikipediaStyling(doc);

    let processedHtml = doc.body.innerHTML;

    const maxLength = 500000;
    if (processedHtml.length > maxLength) {
        processedHtml = processedHtml.substring(0, maxLength) +
            '<div class="alert alert-info mt-3">Article truncated for performance.</div>';
    }

    return processedHtml;
}

function removeUnwantedElements(doc) {
    const selectorsToRemove = [
        '#toc',
        '.toc',
        '.navbox',
        '.vertical-navbox',
        '.metadata',
        '.mbox-small',
        '#siteNotice',
        '.mw-jump-link',
        '.printfooter',
        '.catlinks',
        '.mw-normal-catlinks',
        '#mw-normal-catlinks'
    ];

    for (let i = 0; i < selectorsToRemove.length; i++) {
        try {
            const elements = doc.querySelectorAll(selectorsToRemove[i]);
            for (let j = 0; j < elements.length; j++) {
                elements[j].remove();
            }
        } catch (e) {
        }
    }

    try {
        const tables = doc.querySelectorAll('table');
        for (let i = 0; i < tables.length; i++) {
            const table = tables[i];
            if (table.className.includes('navbox') ||
                table.className.includes('infobox') ||
                table.className.includes('vertical-navbox')) {
                table.remove();
            }
        }
    } catch (e) {
    }
}

function processWikiLinks(doc) {
    try {
        const links = doc.querySelectorAll('a[href^="/wiki/"]');

        for (let i = 0; i < links.length; i++) {
            const link = links[i];
            const href = link.getAttribute('href');
            let title = decodeURIComponent(href.replace('/wiki/', ''));

            title = title.replace(/_/g, ' ');

            if (title.includes('?')) {
                title = title.split('?')[0];
            }

            if (href.includes(':') ||
                href.includes('#') ||
                title.includes('File:') ||
                title.includes('Special:') ||
                title.includes('Help:') ||
                title.includes('Category:')) {
                link.setAttribute('target', '_blank');
                link.setAttribute('rel', 'noopener');
                continue;
            }

            link.classList.add('wiki-game-link');
            link.setAttribute('data-title', title);
            link.setAttribute('href', '#');

            link.removeAttribute('target');
            link.removeAttribute('rel');
        }
    } catch (e) {
        console.error('Error processing links:', e);
    }
}

function addWikipediaStyling(doc) {
    try {
        doc.body.classList.add('wikipedia-body');

        const headings = doc.querySelectorAll('h1, h2, h3, h4, h5, h6');
        for (let i = 0; i < headings.length; i++) {
            headings[i].classList.add('wikipedia-heading');
        }

        const paragraphs = doc.querySelectorAll('p');
        for (let i = 0; i < paragraphs.length; i++) {
            paragraphs[i].classList.add('wikipedia-paragraph');
        }

        const images = doc.querySelectorAll('img');
        for (let i = 0; i < images.length; i++) {
            images[i].classList.add('img-fluid', 'wikipedia-image');
            images[i].style.maxWidth = '100%';
            images[i].style.height = 'auto';
        }
    } catch (e) {
    }
}

function setupWikipediaLinks() {
    try {
        const links = document.querySelectorAll('.wiki-game-link');

        for (let i = 0; i < links.length; i++) {
            const link = links[i];

            link.addEventListener('click', function (e) {
                e.preventDefault();

                if (!currentRoom || currentRoom.status !== 'playing') {
                    return;
                }

                const title = this.dataset.title;
                if (!title) {
                    return;
                }

                this.style.backgroundColor = '#e7f1ff';

                setTimeout(function () {
                    link.style.backgroundColor = '';
                }, 200);

                socket.emit('player:navigate', {
                    roomCode: currentRoomCode,
                    articleTitle: title
                }, function (response) {
                    if (!response.success) {
                        showMessage(response.message || 'Could not move.', true);
                    }
                });
            });

            link.addEventListener('mouseenter', function () {
                this.style.backgroundColor = '#e7f1ff';
            });

            link.addEventListener('mouseleave', function () {
                this.style.backgroundColor = '';
            });
        }

        const linkCount = document.querySelectorAll('.wiki-game-link').length;
        articleCountEl.textContent = 'Links: ' + linkCount;

        const articleContentDiv = document.querySelector('.article-content');
        if (articleContentDiv) {
            articleContentDiv.scrollTop = 0;
        }
    } catch (e) {
        console.error('Error setting up links:', e);
    }
}

async function loadArticle(title) {
    if (!title) {
        return;
    }

    try {
        currentLoadedArticle = title;

        articleContent.innerHTML =
            '<div class="text-center mt-5">' +
            '<div class="spinner-border text-primary" style="width: 3rem; height: 3rem;" role="status">' +
            '<span class="visually-hidden">Loading...</span>' +
            '</div>' +
            '<h4 class="mt-3">Loading "' + title + '"...</h4>' +
            '<p class="text-muted">Fetching from Wikipedia...</p>' +
            '</div>';

        const response = await fetch('/api/article/' + encodeURIComponent(title));
        const data = await response.json();

        if (data.error) {
            articleContent.innerHTML =
                '<div class="alert alert-danger">' +
                '<h4>Error</h4>' +
                '<p>' + data.error + '</p>' +
                '</div>';
            articleCountEl.textContent = '0 available';
            return;
        }

        const processedContent = processWikipediaContent(data.content);

        articleContent.innerHTML =
            '<div class="wikipedia-article">' +
            '<h1 class="article-title">' + data.title + '</h1>' +
            '<hr>' +
            '<div class="article-body">' +
            processedContent +
            '</div>' +
            '</div>';

        setupWikipediaLinks();
    } catch (error) {
        console.error('Failed to load article:', error);
        articleContent.innerHTML =
            '<div class="alert alert-danger">' +
            '<h4>Failed to load article</h4>' +
            '<p>Please check your connection and try again.</p>' +
            '</div>';
        articleCountEl.textContent = '0 available';
    }
}

function renderRoom(room) {
    currentRoom = room;

    roomCodeDisplay.textContent = room.roomCode || '-';
    roomStatus.textContent = room.status || '-';
    goalTitle.textContent = room.goalArticle || '-';

    renderPlayers(room.players, room.hostId, room.winnerId);
    updateRoomSetupVisibility(room);
    updateControlButtons(room);
    updateStats(room);

    const myPlayer = getMyPlayer(room);
    const amIHost = room.hostId === mySocketId;
    const winner = getWinner(room);

    if (myPlayer && room.status === 'playing') {
        currentTitleHeader.innerHTML = 'Current: <span class="text-muted">' + (myPlayer.currentArticle || 'Not started') + '</span>';
    } else if (room.status !== 'playing') {
        currentTitleHeader.innerHTML = 'Current: <span class="text-muted">Not started</span>';
    }

    if (room.status === 'lobby') {
        startGameBtn.style.display = amIHost ? 'block' : 'none';
        stopTimer();
        timerEl.textContent = '00:00';
        resetArticleView('Waiting for the host to start the game.');

        if (amIHost) {
            showMessage('You are the host. Start when everyone is ready.');
        } else {
            showMessage('Waiting for the host to start the game.');
        }
    } else if (room.status === 'playing') {
        startGameBtn.style.display = 'none';
        showMessage('Game in progress.');
        startTimer();

        if (myPlayer && myPlayer.currentArticle && currentLoadedArticle !== myPlayer.currentArticle) {
            loadArticle(myPlayer.currentArticle);
        }
    } else if (room.status === 'finished') {
        startGameBtn.style.display = amIHost ? 'block' : 'none';
        stopTimer();
        resetArticleView('The game has ended. Start a new game when ready.');

        if (winner) {
            if (winner.id === mySocketId) {
                showMessage('You won! ');
            } else {
                showMessage(winner.name + ' won the game ');
            }
        } else {
            showMessage('Game finished.');
        }
    } else {
        startGameBtn.style.display = 'none';
        stopTimer();
    }
}

createRoomBtn.addEventListener('click', function () {
    const playerName = getPlayerName();

    socket.emit('room:create', playerName, function (response) {
        if (response.success) {
            currentRoomCode = response.roomCode;
            currentLoadedArticle = '';
            renderRoom(response.room);
            showMessage('Room ' + response.roomCode + ' created.');
        } else {
            showMessage('Failed to create room.', true);
        }
    });
});

joinRoomBtn.addEventListener('click', function () {
    const playerName = getPlayerName();
    const roomCode = roomCodeInput.value.trim().toUpperCase();

    if (!roomCode) {
        showMessage('Please enter a room code.', true);
        return;
    }

    socket.emit('room:join', { roomCode: roomCode, playerName: playerName }, function (response) {
        if (response.success) {
            currentRoomCode = response.roomCode;
            currentLoadedArticle = '';
            renderRoom(response.room);
            showMessage('Joined room ' + response.roomCode + '.');
        } else {
            showMessage(response.message || 'Failed to join room.', true);
        }
    });
});

startGameBtn.addEventListener('click', function () {
    if (!currentRoomCode) {
        showMessage('Create or join a room first.', true);
        return;
    }

    socket.emit('game:start', currentRoomCode, function (response) {
        if (response.success) {
            currentLoadedArticle = '';
            renderRoom(response.room);
            showMessage('Game started.');
        } else {
            showMessage(response.message || 'Failed to start game.', true);
        }
    });
});

newGameBtn.addEventListener('click', function () {
    if (!currentRoomCode) {
        showMessage('Create or join a room first.', true);
        return;
    }

    socket.emit('game:start', currentRoomCode, function (response) {
        if (response.success) {
            currentLoadedArticle = '';
            renderRoom(response.room);
            showMessage('New game started.');
        } else {
            showMessage(response.message || 'Only the host can start a new game.', true);
        }
    });
});

giveUpBtn.addEventListener('click', function () {
    if (!currentRoomCode || !currentRoom || currentRoom.status !== 'playing') {
        showMessage('There is no active game to give up.', true);
        return;
    }

    socket.emit('player:giveup', { roomCode: currentRoomCode }, function (response) {
        if (!response.success) {
            showMessage(response.message || 'Could not give up.', true);
        }
    });
});

socket.on('room:update', function (room) {
    if (!room) {
        return;
    }

    if (currentRoomCode && room.roomCode === currentRoomCode) {
        renderRoom(room);
    }
});

resetArticleView();
updateControlButtons(null);