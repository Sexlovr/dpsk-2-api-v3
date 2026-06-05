#!/bin/bash

# Setup virtual display
export DISPLAY=:99
Xvfb :99 -screen 0 1280x720x24 &
sleep 2

# Start a basic window manager
fluxbox &

# Start VNC Server internally on port 5900
x11vnc -display :99 -forever -shared -bg -nopw -rfbport 5900

# Start websockify (noVNC WebSocket bridge) on port 6080
# Serves the noVNC web client AND proxies WebSocket to VNC
websockify --web /usr/share/novnc 6080 localhost:5900 &

# Start our Node Express app (Hugging Face routes to 7860 natively)
export PORT=7860
node index.js
