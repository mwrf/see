See - A simple short URL redirect thing. 

Notes
-----------
Requires node.js
http://www.nodejs.org

Requires node-supervisor for automatic watching of mappings file:
https://github.com/isaacs/node-supervisor

Installation
------------
First install supervisor by running 
"npm install supervisor -g" at a command prompt 

Then run the see server by running (port 80 by default):
"supervisor --watch mappings.json see.js"

