/*
 *     Simple short URL server
 */
 
var http = require('http');
var mappings = require('./mappings.json');;

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
    response.write("Available URLs: <br> <br>");
    response.write("<table border='1' cellpadding='4'>");
    response.write("<tr><th>Short URL</th><th>Full URL</th></tr>");
    iterate(mappings, function (url, mapping) {
        response.write("<tr><td><a href='" + url + "'>" + url + "</a></td><td>" + mapping + "</td>");
    });
    response.write("</table>");  
    response.write(generateFooter());
};

http.createServer(function (request, response) {
    var loc = getRedirectURL(request.url);
    console.log("Request to " + request.url);
    if (!loc) {
        generateNotFound(request, response);
    } else {
    	  console.log("Redirecting to " + loc);
        response.writeHead(302, {
            "Location": loc
        });
    }
    response.end();
}).listen(80);

console.log("Started see on port 80");




