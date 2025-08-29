const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const { nanoid } = require('nanoid');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const PORT = process.env.PORT || 3000;

// Serve static files (if any, not strictly needed for this setup)
app.use(express.static(path.join(__dirname)));

// This route handles direct links to rooms. It serves the main HTML file,
// and the client-side JavaScript will handle the rest.
app.get('/room/:roomCode', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// The main route still serves the HTML file for the lobby.
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});


// In-memory store for rooms
// Now stores an array of user objects {id, username}
const rooms = {};

io.on('connection', (socket) => {
    console.log('A user connected:', socket.id);

    // --- Room Management ---
    socket.on('create-room', ({ username }) => {
        const roomCode = nanoid(6); // Generate a 6-character room code
        rooms[roomCode] = [{ id: socket.id, username: username }];
        socket.join(roomCode);
        socket.roomCode = roomCode; // Store room code on socket object
        socket.username = username; // Store username on socket object
        socket.emit('room-created', roomCode);
        io.to(roomCode).emit('update-user-list', rooms[roomCode]);
        console.log(`Room ${roomCode} created by ${username} (${socket.id})`);
    });

    socket.on('join-room', ({ roomCode, username }) => {
        if (rooms[roomCode]) {
            const user = { id: socket.id, username: username };
            rooms[roomCode].push(user);
            socket.join(roomCode);
            socket.roomCode = roomCode;
            socket.username = username;
            
            // Notify others in the room that a new user has joined
            socket.to(roomCode).emit('user-joined', user);

            socket.emit('joined-room', roomCode);
            io.to(roomCode).emit('update-user-list', rooms[roomCode]);
            console.log(`${username} (${socket.id}) joined room ${roomCode}`);
        } else {
            socket.emit('join-error', 'Invalid room code.');
        }
    });

    // --- Share Request Flow ---
    socket.on('request-share', ({ targetId }) => {
        console.log(`${socket.username} (${socket.id}) is requesting to view ${targetId}'s screen`);
        io.to(targetId).emit('share-request-received', { requesterId: socket.id, requesterUsername: socket.username });
    });

    socket.on('reject-share', ({ requesterId }) => {
        const targetSocket = io.sockets.sockets.get(requesterId);
        if (targetSocket) {
             console.log(`${socket.username} (${socket.id}) rejected share request from ${targetSocket.username}`);
             targetSocket.emit('share-rejected', { rejecterId: socket.id, rejecterUsername: socket.username });
        }
    });

    // --- NEW: More explicit stop sharing notification ---
    socket.on('stop-sharing-notification', () => {
        if (socket.roomCode) {
            // Let everyone else in the room know the share has stopped
            socket.to(socket.roomCode).emit('share-stopped');
            // Also update the user list for everyone to remove the "sharing" icon
            io.to(socket.roomCode).emit('update-user-list', rooms[socket.roomCode]);
        }
    });
    
    // --- Remote Control Flow ---
    socket.on('request-control', ({ targetId }) => {
        console.log(`${socket.username} requests control from ${targetId}`);
        io.to(targetId).emit('control-request-received', { requesterId: socket.id, requesterUsername: socket.username });
    });

    socket.on('accept-control', ({ requesterId }) => {
        console.log(`${socket.username} accepted control from ${requesterId}`);
        io.to(requesterId).emit('control-accepted', { targetId: socket.id });
    });

    socket.on('reject-control', ({ requesterId }) => {
         const targetSocket = io.sockets.sockets.get(requesterId);
        if(targetSocket) {
            console.log(`${socket.username} rejected control from ${requesterId}`);
            targetSocket.emit('control-rejected', { rejecterUsername: socket.username });
        }
    });
    
    // --- WebRTC Signaling (Targeted) ---
    socket.on('webrtc-offer', ({ offer, toId, fromId }) => {
        // Also notify the room who is sharing now for the UI update
        if(socket.roomCode) {
            io.to(socket.roomCode).emit('sharer-started', { sharerId: fromId });
        }
        io.to(toId).emit('webrtc-offer', { offer, fromId: fromId });
    });

    socket.on('webrtc-answer', ({ answer, toId }) => {
        io.to(toId).emit('webrtc-answer', { answer, fromId: socket.id });
    });

    socket.on('webrtc-candidate', ({ candidate, toId }) => {
        io.to(toId).emit('webrtc-candidate', { candidate, fromId: socket.id });
    });
    
    // --- Chat Logic ---
    socket.on('send-chat-message', ({ message }) => {
        if (socket.roomCode && socket.username) {
            // Broadcast the message to everyone in the same room
            io.to(socket.roomCode).emit('new-chat-message', { 
                username: socket.username, 
                message: message 
            });
        }
    });

    // --- Disconnect Handling ---
    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
        const roomCode = socket.roomCode;
        if (roomCode && rooms[roomCode]) {
            // Find the user who disconnected
            const disconnectedUser = rooms[roomCode].find(user => user.id === socket.id);
            
            // Remove user from the room's array
            rooms[roomCode] = rooms[roomCode].filter(user => user.id !== socket.id);
            
            if (disconnectedUser) {
                // Notify remaining users that this user has left
                socket.to(roomCode).emit('user-left', disconnectedUser);
            }

            // If room is empty, delete it
            if (rooms[roomCode].length === 0) {
                delete rooms[roomCode];
                console.log(`Room ${roomCode} is now empty and has been deleted.`);
            } else {
                // Otherwise, update the user list for remaining users
                io.to(roomCode).emit('update-user-list', rooms[roomCode]);
                // If the person who disconnected was the one sharing, notify everyone
                io.to(roomCode).emit('share-stopped'); 
            }
        }
    });
});

server.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});

