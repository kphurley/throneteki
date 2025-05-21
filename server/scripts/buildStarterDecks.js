/*eslint no-console:0 */

import monk from 'monk';
import ServiceFactory from '../services/ServiceFactory.js';
import CardService from '../services/CardService.js';
import DeckService from '../services/DeckService.js';

class BuildStarterDecks {
    constructor() {
        let configService = ServiceFactory.configService();
        this.db = monk(configService.getValue('dbPath'));
        this.cardService = new CardService(this.db);
        this.deckService = new DeckService(this.db, this.cardService);
    }

    async build() {
        try {
            await this.deckService.init();
            this.cards = await this.cardService.getAllCards();

            const sithStarterDeck = this.formatDeck(
                this.buildDeck({
                    name: 'Sith Starter Deck',
                    username: 'STARTERDECKS',
                    affiliation: 'Sith',
                    side: 'Dark',
                    blockNumbers: [19, 20, 21, 22, 23, 24, 25, 36]
                })
            );

            const jediStarterDeck = this.formatDeck(
                this.buildDeck({
                    name: 'Jedi Starter Deck',
                    username: 'STARTERDECKS',
                    affiliation: 'Jedi',
                    side: 'Light',
                    blockNumbers: [1, 2, 3, 4, 5, 6, 7, 18]
                })
            );

            await this.deckService.create(sithStarterDeck);
            await this.deckService.create(jediStarterDeck);
        } catch (err) {
            console.error('Could not finish import', err);
        } finally {
            this.db.close();
        }
    }

    formatDeck(deck) {
        let drawCards = deck.cards.filter((card) =>
            ['Enhancement', 'Event', 'Fate', 'Mission', 'Unit'].includes(this.cards[card.code].type)
        );
        let objectiveCards = deck.cards.filter(
            (card) => this.cards[card.code].type === 'Objective'
        );
        let formattedDeck = {
            name: deck.name,
            side: deck.side,
            username: deck.username,

            // Not sure if aggregating counts is important yet
            drawCards: drawCards.map((card) => ({ count: 1, card: card })),
            objectiveCards: objectiveCards.map((card) => ({
                count: 1,
                card: card
            })),
            lastUpdated: Date.now(),
            affiliation: deck.affiliation
        };

        return formattedDeck;
    }

    buildDeck({ name, username, affiliation, side, blockNumbers }) {
        let deck = {
            name,
            username,
            side,
            cards: []
        };

        deck.affiliation = Object.values(this.cards).find(
            (card) => card.type === 'Affiliation' && card.affiliationName === affiliation
        );

        for (let blockNumber of blockNumbers) {
            let cardsInBlock = Object.values(this.cards).filter(
                (card) => card.block === blockNumber
            );
            deck.cards = deck.cards.concat(cardsInBlock);
        }

        return deck;
    }
}

let builder = new BuildStarterDecks();
await builder.build();

process.exit(0);
