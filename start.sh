#!/bin/bash

# Start our Node Express app ONLY - no VNC at boot
# VNC will be launched on-demand by browser_controller.js
export PORT=7860
node index.js
