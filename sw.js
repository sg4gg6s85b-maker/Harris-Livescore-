// HARRIS LIVESCORE - PUSH NOTIFICATION SERVICE WORKER

self.addEventListener("push", function (event) {
    let data = {
        title: "Harris Livescore 🔔",
        body: "You have a new match update!",
        url: "/"
    };

    if (event.data) {
        try {
            data = {
                ...data,
                ...event.data.json()
            };
        } catch (error) {
            data.body = event.data.text();
        }
    }

    const options = {
        body: data.body,
        icon: "/icon-192.png",
        badge: "/icon-192.png",
        data: {
            url: data.url || "/"
        },
        vibrate: [200, 100, 200],
        tag: data.tag || "harris-match-alert",
        renotify: true
    };

    event.waitUntil(
        self.registration.showNotification(data.title, options)
    );
});

self.addEventListener("notificationclick", function (event) {
    event.notification.close();

    const targetUrl =
        event.notification.data?.url || "/";

    event.waitUntil(
        clients.matchAll({
            type: "window",
            includeUncontrolled: true
        }).then(function (clientList) {
            for (const client of clientList) {
                if ("focus" in client) {
                    return client.focus().then(() => {
                        return client.navigate(targetUrl);
                    });
                }
            }

            return clients.openWindow(targetUrl);
        })
    );
});
