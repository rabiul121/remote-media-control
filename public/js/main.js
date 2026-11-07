// Starts everything once all files have loaded.
// (Plain script: files share one global scope and load in the order listed in index.html.)

if (token) startSession();
else connected(false);
