/*eslint no-console:0 */
import fs from 'fs';

import path from 'path';
import _ from 'underscore';

class JsonCardSource {
    constructor(directory) {
        let data = this.loadPackFiles(directory);
        this.packs = data.packs;
        this.cards = data.cards;
    }

    loadPackFiles(directory) {
        let packs = [];
        let cards = [];
        let files = fs.readdirSync(path.join(directory, 'packs'));
        for (let file of files) {
            let pack = JSON.parse(fs.readFileSync(path.join(directory, 'packs', file)));
            for (let card of pack.cards) {
                card.packCode = pack.code;
            }

            packs.push({
                cgdbId: pack.cgdbId,
                code: pack.code,
                name: pack.name,
                releaseDate: pack.releaseDate
            });
            cards = cards.concat(pack.cards);
        }

        this.addLabelToCards(cards);

        return {
            cards: cards,
            packs: packs
        };
    }

    addLabelToCards(cards) {
        // Don't need to worry about this yet

        // for (let card of cards) {
        //     let cardsByName = _.filter(cards, (filterCard) => {
        //         return filterCard.name === card.name;
        //     });

        //     if (cardsByName.length > 1) {
        //         card.label = card.name + ' (' + card.packCode + ')';
        //     } else {
        //         card.label = card.name;
        //     }
        // }

        // Just going to set it to the name for now
        for (let card of cards) {
            card.label = card.name;
        }
    }

    getCards() {
        return this.cards;
    }

    getPacks() {
        return this.packs;
    }
}

export default JsonCardSource;
