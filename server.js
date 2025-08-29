const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const { nanoid } = require('nanoid');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const PORT = process.env.PORT || 3000;

// Serve the HTML file
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// In-memory store for rooms
const rooms = {};

io.on('connection', (socket) => {
    console.log('A user connected:', socket.id);

    // --- Room Management ---
    socket.on('create-room', () => {
        const roomCode = nanoid(6); // Generate a 6-character room code
        rooms[roomCode] = [socket.id];
        socket.join(roomCode);
        socket.roomCode = roomCode; // Store room code on socket object
        socket.emit('room-created', roomCode);
        io.to(roomCode).emit('update-user-list', rooms[roomCode]);
        console.log(`Room ${roomCode} created by ${socket.id}`);
    });

    socket.on('join-room', (roomCode) => {
        if (rooms[roomCode]) {
            rooms[roomCode].push(socket.id);
            socket.join(roomCode);
            socket.roomCode = roomCode;
            socket.emit('joined-room', roomCode);
            io.to(roomCode).emit('update-user-list', rooms[roomCode]);
            console.log(`${socket.id} joined room ${roomCode}`);
        } else {
            socket.emit('join-error', 'Invalid room code.');
        }
    });

    // --- Share Request Flow ---
    socket.on('request-share', ({ targetId }) => {
        console.log(`${socket.id} is requesting to view ${targetId}'s screen`);
        io.to(targetId).emit('share-request-received', { requesterId: socket.id });
    });

    socket.on('reject-share', ({ requesterId }) => {
        console.log(`${socket.id} rejected share request from ${requesterId}`);
        io.to(requesterId).emit('share-rejected', { rejecterId: socket.id });
    });
    
    // --- WebRTC Signaling (Targeted) ---
    socket.on('webrtc-offer', ({ offer, toId }) => {
        io.to(toId).emit('webrtc-offer', { offer, fromId: socket.id });
    });

    socket.on('webrtc-answer', ({ answer, toId }) => {
        io.to(toId).emit('webrtc-answer', { answer, fromId: socket.id });
    });

    socket.on('webrtc-candidate', ({ candidate, toId }) => {
        io.to(toId).emit('webrtc-candidate', { candidate, fromId: socket.id });
    });
    
    socket.on('stop-sharing', ({room}) => {
        if(room && rooms[room]){
            io.to(room).emit('share-stopped');
        }
    });

    // --- Disconnect Handling ---
    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
        const roomCode = socket.roomCode;
        if (roomCode && rooms[roomCode]) {
            // Remove user from room
            rooms[roomCode] = rooms[roomCode].filter(id => id !== socket.id);
            // If room is empty, delete it
            if (rooms[roomCode].length === 0) {
                delete rooms[roomCode];
                console.log(`Room ${roomCode} is now empty and has been deleted.`);
            } else {
                // Otherwise, update the user list for remaining users
                io.to(roomCode).emit('update-user-list', rooms[roomCode]);
                io.to(roomCode).emit('share-stopped'); // also stop sharing if sharer disconnects
            }
        }
    });
});

server.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
