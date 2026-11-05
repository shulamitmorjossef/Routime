const { app } = require('@azure/functions');
const { CosmosClient } = require('@azure/cosmos');
const { DefaultAzureCredential } = require('@azure/identity');

const credential = new DefaultAzureCredential();

const client = new CosmosClient({
    endpoint: process.env.COSMOS_ENDPOINT,
    aadCredentials: credential
});

const database = client.database(process.env.COSMOS_DATABASE);
const container = database.container(process.env.COSMOS_CONTAINER);

app.http('events', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'events/{id?}',
    handler: async (request, context) => {
        context.log('Getting events from Cosmos DB');

        const { resources } = await container.items
            .query('SELECT * FROM c')
            .fetchAll();

        return {
            jsonBody: {
                events: resources
            }
        };
    }
});