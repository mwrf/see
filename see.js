/*
 *     Simple short URL server
 */
 
var http = require('http');
var fs = require('fs');
var mappings = require('./mappings.json');

// periodically reloads the mappings file
setInterval(function(){
	var name = require.resolve('./mappings.json');
	delete require.cache[name];
	mappings = require('./mappings.json');
}, 5 * 1000);

// utility function to walk over objects
function iterate(object, fn, scope) {
    for (var property in object) {
        if (object.hasOwnProperty(property)) {
            if (fn.call(scope || object, property, object[property], object) === false) {
                return;
            }
        }
    }
};

// returns any found URL mapping for the given request
function getRedirectURL(requestURL) {
    var found;
    iterate(mappings, function (url, mapping) {
        if (requestURL === url) {
            found = mapping
        }
        return;
    });
    return found;
};

function generateHeader(){
  return "<html><body>"
}

function generateFooter(){
  return "<br>see - A simple short url server. Modify mappings.json to add / remove urls</body></html>";
}

function generateNotFound(request, response) {
    response.write(generateHeader());
    response.write("<b>" + request.url + ",</b> does not exist! <br>");
    response.write("<p><a href='/'>Manage Links</a></p>"); // Added link to management UI
    response.write("Available URLs: <br> <br>");
    response.write("<table border='1' cellpadding='4'>");
    response.write("<tr><th>Short URL</th><th>Full URL</th></tr>");
    iterate(mappings, function (url, mapping) {
        response.write("<tr><td><a href='" + url + "'>" + url + "</a></td><td>" + mapping + "</td>");
    });
    response.write("</table>");  
    response.write(generateFooter());
};

var port = process.argv[2] || 80;

http.createServer(function (request, response) {
    if (request.url === '/') {
        fs.readFile('index.html', function(err, data) {
            if (err) {
                response.writeHead(500);
                response.end('Error loading index.html');
            } else {
                response.writeHead(200, {'Content-Type': 'text/html'});
                response.end(data);
            }
        });
    } else if (request.url === '/mappings') {
        response.writeHead(200, {'Content-Type': 'application/json'});
        response.end(JSON.stringify(mappings));
    } else if (request.url === '/add' && request.method === 'POST') {
        let body = '';
        request.on('data', chunk => {
            body += chunk.toString();
        });
        request.on('end', () => {
            const params = new URLSearchParams(body);
            const short_url = params.get('short_url');
            const full_url = params.get('full_url');
            if (short_url && full_url) {
                mappings[short_url] = full_url;
                fs.writeFile('mappings.json', JSON.stringify(mappings, null, 4), err => {
                    if (err) {
                        console.error("Error writing mappings.json:", err);
                        response.writeHead(500);
                        response.end('Error saving mapping');
                        return;
                    }
                    response.writeHead(302, { 'Location': '/' });
                    response.end();
                });
            } else {
                response.writeHead(400);
                response.end('Missing short_url or full_url');
            }
        });
    } else if (request.url === '/delete' && request.method === 'POST') {
        let body = '';
        request.on('data', chunk => {
            body += chunk.toString();
        });
        request.on('end', () => {
            const params = JSON.parse(body);
            const short_url = params.short_url;
            if (short_url && mappings[short_url]) {
                delete mappings[short_url];
                fs.writeFile('mappings.json', JSON.stringify(mappings, null, 4), err => {
                    if (err) {
                        console.error("Error writing mappings.json:", err);
                        response.writeHead(500);
                        response.end('Error deleting mapping');
                        return;
                    }
                    response.writeHead(200);
                    response.end('Mapping deleted');
                });
            } else {
                response.writeHead(400);
                response.end('Invalid short_url or mapping does not exist');
            }
        });
    }
    else {
        var loc = getRedirectURL(request.url);
        console.log("Request to " + request.url);
        if (!loc) {
            generateNotFound(request, response);
            response.end();
        } else {
            console.log("Redirecting to " + loc);
            response.writeHead(302, {
                "Location": loc
            });
            response.end();
        }
    }
}).listen(port);

console.log("Started see on port " + port);




