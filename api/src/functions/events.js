const { app } = require('@azure/functions');

app.http('events', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'events/{id?}',
    handler: async (request, context) => {
        context.log('Geting events');

        return { 
            jsonBody: {
                events: []
            }
        };
    }
});
