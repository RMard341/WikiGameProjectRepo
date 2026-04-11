const express = require('express');
const fetch = require('node-fetch');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3001;

const topicClusters = {
    Science: ['Physics', 'Chemistry', 'Biology', 'Astronomy', 'Mathematics'],
    History: ['Ancient History', 'Medieval History', 'World War II', 'Civilizations'],
    Art: ['Painting', 'Sculpture', 'Renaissance Art', 'Modern Art'],
    Music: ['Classical Music', 'Rock Music', 'Jazz', 'Musicians'],
    Technology: ['Computers', 'Internet', 'Programming', 'Artificial Intelligence'],
    Philosophy: ['Ethics', 'Metaphysics', 'Epistemology', 'Logic'],
    Literature: ['Novels', 'Poetry', 'Writers', 'Literary Movements'],
    Sports: ['Olympic Games', 'Football', 'Basketball', 'Athletes']
};

const rooms = {};

app.use(express.static('public'));

app.get('/', (req, res) => {
    res.send('Server is working! Go to <a href="/SinglePlayer.html">Single Player</a> or <a href="/multiplayer.html">Multiplayer</a>');
});

async function getRandomWikipediaArticle() {
    const response = await fetch(
        'https://en.wikipedia.org/w/api.php?action=query&format=json&list=random&rnnamespace=0&rnlimit=1&origin=*'
    );
    const data = await response.json();
    return data.query.random[0].title;
}

app.get('/api/random-article', async (req, res) => {
    try {
        const title = await getRandomWikipediaArticle();
        res.json({ title });
    } catch (error) {
        console.error('Error getting random article:', error);
        const articles = ['Philosophy', 'Science', 'History', 'Art', 'Music'];
        const random = articles[Math.floor(Math.random() * articles.length)];
        res.json({ title: random });
    }
});

app.get('/api/article/:title', async (req, res) => {
    try {
        const title = req.params.title;

        const response = await fetch(
            `https://en.wikipedia.org/w/api.php?action=parse&page=${encodeURIComponent(title)}&format=json&prop=text&origin=*`
        );
        const data = await response.json();

        if (data.error || !data.parse) {
            return res.status(404).json({ error: 'Article not found' });
        }

        res.json({
            title: data.parse.title,
            content: data.parse.text['*']
        });
    } catch (error) {
        console.error('Error fetching article:', error);
        res.status(500).json({ error: 'Failed to fetch article' });
    }
});

app.get('/api/related-article-simple/:title', async (req, res) => {
    const categories = Object.keys(topicClusters);
    const randomCategory = categories[Math.floor(Math.random() * categories.length)];
    const topics = topicClusters[randomCategory];
    const related = topics[Math.floor(Math.random() * topics.length)];
    res.json({ title: related });
});

app.get('/api/best-link', async (req, res) => {
    try {
        const { current, goal } = req.query;

        if (!current || !goal) {
            return res.status(400).json({ error: 'Missing current or goal article' });
        }

        const currentResponse = await fetch(
            `https://en.wikipedia.org/w/api.php?action=parse&page=${encodeURIComponent(current)}&format=json&prop=links&origin=*`
        );
        const currentData = await currentResponse.json();

        if (!currentData.parse || !currentData.parse.links) {
            return res.json({ bestLink: null, message: 'Could not analyze article links' });
        }

        const links = currentData.parse.links
            .filter(link => link.ns === 0)
            .map(link => link['*']);

        if (links.length === 0) {
            return res.json({ bestLink: null, message: 'No links found in this article' });
        }

        const goalLower = goal.toLowerCase();

        for (const link of links) {
            if (link.toLowerCase() === goalLower) {
                return res.json({
                    bestLink: link,
                    message: `"${link}" - THIS IS YOUR GOAL! Click it to win!`,
                    directMatch: true,
                    isGoal: true
                });
            }
        }

        const goalWords = goalLower.split(' ');
        for (const link of links) {
            const linkLower = link.toLowerCase();

            for (const word of goalWords) {
                if (word.length > 3 && linkLower.includes(word)) {
                    return res.json({
                        bestLink: link,
                        message: `"${link}" - contains "${word}" which relates to your goal "${goal}"`,
                        partialMatch: true
                    });
                }
            }
        }

        const randomLink = links[Math.floor(Math.random() * links.length)];
        res.json({
            bestLink: randomLink,
            message: `Try "${randomLink}" - no clearly related links found`,
            isRandom: true
        });

    } catch (error) {
        console.error('Error finding best link:', error);
        res.status(500).json({ error: 'Failed to analyze links' });
    }
});

function generateRoomCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';

    for (let i = 0; i < 6; i++) {
        code += chars[Math.floor(Math.random() * chars.length)];
    }

    return code;
}

function getRoomState(roomCode) {
    const room = rooms[roomCode];

    if (!room) {
        return null;
    }

    return {
        roomCode: roomCode,
        hostId: room.hostId,
        status: room.status,
        startArticle: room.startArticle,
        goalArticle: room.goalArticle,
        winnerId: room.winnerId,
        startedAt: room.startedAt,
        players: room.players
    };
}

io.on('connection', (socket) => {
    console.log('Player connected:', socket.id);

    socket.on('room:create', (playerName, callback) => {
        const roomCode = generateRoomCode();

        rooms[roomCode] = {
            hostId: socket.id,
            status: 'lobby',
            startArticle: null,
            goalArticle: null,
            winnerId: null,
            startedAt: null,
            players: [
                {
                    id: socket.id,
                    name: playerName || 'Player 1',
                    currentArticle: null,
                    moves: 0,
                    finished: false
                }
            ]
        };

        socket.join(roomCode);

        const roomState = getRoomState(roomCode);

        if (callback) {
            callback({
                success: true,
                roomCode: roomCode,
                room: roomState
            });
        }

        io.to(roomCode).emit('room:update', roomState);
    });

    socket.on('room:join', (data, callback) => {
        const roomCode = data.roomCode;
        const playerName = data.playerName;
        const room = rooms[roomCode];

        if (!room) {
            if (callback) {
                callback({ success: false, message: 'Room not found' });
            }
            return;
        }

        if (room.players.length >= 50) {
            if (callback) {
                callback({ success: false, message: 'Room is full' });
            }
            return;
        }

        if (room.status !== 'lobby') {
            if (callback) {
                callback({ success: false, message: 'Game already started' });
            }
            return;
        }

        room.players.push({
            id: socket.id,
            name: playerName || 'Player',
            currentArticle: null,
            moves: 0,
            finished: false
        });

        socket.join(roomCode);

        const roomState = getRoomState(roomCode);

        if (callback) {
            callback({
                success: true,
                roomCode: roomCode,
                room: roomState
            });
        }

        io.to(roomCode).emit('room:update', roomState);
    });

    socket.on('game:start', async (roomCode, callback) => {
        const room = rooms[roomCode];

        if (!room) {
            if (callback) {
                callback({ success: false, message: 'Room not found' });
            }
            return;
        }

        if (room.hostId !== socket.id) {
            if (callback) {
                callback({ success: false, message: 'Only the host can start the game' });
            }
            return;
        }

        if (room.players.length < 2) {
            if (callback) {
                callback({ success: false, message: 'Need at least 2 players to start' });
            }
            return;
        }

        try {
            let startArticle = await getRandomWikipediaArticle();
            let goalArticle = await getRandomWikipediaArticle();

            while (goalArticle === startArticle) {
                goalArticle = await getRandomWikipediaArticle();
            }

            room.status = 'playing';
            room.startArticle = startArticle;
            room.goalArticle = goalArticle;
            room.winnerId = null;
            room.startedAt = Date.now();

            room.players.forEach(player => {
                player.currentArticle = startArticle;
                player.moves = 0;
                player.finished = false;
            });

            const roomState = getRoomState(roomCode);
            io.to(roomCode).emit('room:update', roomState);

            if (callback) {
                callback({
                    success: true,
                    room: roomState
                });
            }
        } catch (error) {
            console.error('Error starting game:', error);

            if (callback) {
                callback({ success: false, message: 'Failed to start game' });
            }
        }
    });

    socket.on('player:giveup', (data, callback) => {
        const roomCode = data.roomCode;
        const room = rooms[roomCode];

        if (!room) {
            if (callback) {
                callback({ success: false, message: 'Room not found' });
            }
            return;
        }

        if (room.status !== 'playing') {
            if (callback) {
                callback({ success: false, message: 'Game is not active' });
            }
            return;
        }

        const player = room.players.find(p => p.id === socket.id);

        if (!player) {
            if (callback) {
                callback({ success: false, message: 'Player not found in room' });
            }
            return;
        }

        player.finished = true;
        room.status = 'finished';

        const remainingPlayer = room.players.find(p => p.id !== socket.id);
        room.winnerId = remainingPlayer ? remainingPlayer.id : null;

        const roomState = getRoomState(roomCode);
        io.to(roomCode).emit('room:update', roomState);

        if (callback) {
            callback({
                success: true,
                room: roomState
            });
        }
    });

    socket.on('player:navigate', (data, callback) => {
        const roomCode = data.roomCode;
        const articleTitle = data.articleTitle;
        const room = rooms[roomCode];

        if (!room) {
            if (callback) {
                callback({ success: false, message: 'Room not found' });
            }
            return;
        }

        if (room.status !== 'playing') {
            if (callback) {
                callback({ success: false, message: 'Game is not active' });
            }
            return;
        }

        const player = room.players.find(p => p.id === socket.id);

        if (!player) {
            if (callback) {
                callback({ success: false, message: 'Player not found in room' });
            }
            return;
        }

        if (room.winnerId) {
            if (callback) {
                callback({ success: false, message: 'Game already finished' });
            }
            return;
        }

        player.currentArticle = articleTitle;
        player.moves += 1;

        if (articleTitle === room.goalArticle) {
            player.finished = true;
            room.winnerId = socket.id;
            room.status = 'finished';
        }

        const roomState = getRoomState(roomCode);
        io.to(roomCode).emit('room:update', roomState);

        if (callback) {
            callback({
                success: true,
                room: roomState
            });
        }
    });

    socket.on('disconnect', () => {
        console.log('Player disconnected:', socket.id);

        for (const roomCode in rooms) {
            const room = rooms[roomCode];
            const playerIndex = room.players.findIndex(player => player.id === socket.id);

            if (playerIndex !== -1) {
                room.players.splice(playerIndex, 1);

                if (room.players.length === 0) {
                    delete rooms[roomCode];
                } else {
                    if (room.hostId === socket.id) {
                        room.hostId = room.players[0].id;
                    }

                    io.to(roomCode).emit('room:update', getRoomState(roomCode));
                }

                break;
            }
        }
    });
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
});