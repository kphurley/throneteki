import cards from './cards/index.js';
import DrawCard from './drawcard.js';
import PlotCard from './plotcard.js';
import ObjectiveCard from './objectivecard.js';
import AgendaCard from './agendacard.js';
import Factions from './Factions.js';

class Deck {
    constructor(data) {
        this.data = data;
    }

    createFactionCard(player) {
        if (this.data.faction) {
            let factionData = Factions.find((faction) => faction.value === this.data.faction.value);
            return new DrawCard(player, {
                code: this.data.faction.value,
                type: 'faction',
                faction: this.data.faction.value,
                name: factionData && factionData.name,
                label: factionData && factionData.name
            });
        }

        return new DrawCard(player, { type: 'faction' });
    }

    createAgendaCards(player) {
        if (!this.data.agenda) {
            return;
        }

        // Conditionally collect all possible additional agendas
        const agendas = [this.data.agenda, ...(this.data.bannerCards ? this.data.bannerCards : [])];
        return agendas.map((agenda) => this.createCardForType(AgendaCard, player, agenda));
    }

    createAffiliationCard(player) {
        if (!this.data.affiliation) {
            return;
        }

        return new DrawCard(player, {
            code: this.data.affiliation.value,
            type: 'affiliation',
            faction: this.data.affiliation.value,
            name: this.data.affiliation.name,
            label: this.data.affiliation.name
        });
    }

    isPlotCard(cardData) {
        return cardData.type === 'plot';
    }

    isObjectiveCard(cardData) {
        return cardData.type === 'Objective';
    }

    isDrawCard(cardData) {
        //return ['attachment', 'character', 'event', 'location'].includes(cardData.type);
        return ['Enhancement', 'Event', 'Fate', 'Mission', 'Unit'].includes(cardData.type);
    }

    prepare(player) {
        let result = {
            drawCards: [],
            //plotCards: []
            objectiveCards: []
        };

        this.eachRepeatedCard(this.data.drawCards || [], (cardData) => {
            if (this.isDrawCard(cardData)) {
                var drawCard = this.createCardForType(DrawCard, player, cardData);
                drawCard.moveTo('draw deck');
                result.drawCards.push(drawCard);
            }
        });

        // this.eachRepeatedCard(this.data.plotCards || [], (cardData) => {
        //     if (this.isPlotCard(cardData)) {
        //         var plotCard = this.createCardForType(PlotCard, player, cardData);
        //         plotCard.moveTo('plot deck');
        //         result.plotCards.push(plotCard);
        //     }
        // });

        this.eachRepeatedCard(this.data.objectiveCards || [], (cardData) => {
            if (this.isObjectiveCard(cardData)) {
                var objectiveCard = this.createCardForType(ObjectiveCard, player, cardData);
                // TODO: Move to objective deck instead
                objectiveCard.moveTo('plot deck');
                result.objectiveCards.push(objectiveCard);
            }
        });

        // result.faction = this.createFactionCard(player);
        // result.faction.moveTo('faction');

        result.allCards = result.drawCards.concat(result.objectiveCards);

        // result.agendas = this.createAgendaCards(player);
        // if (result.agendas) {
        //     for (const agenda of result.agendas) {
        //         agenda.moveTo('agenda');
        //         result.allCards.push(agenda);
        //     }
        // }

        return result;
    }

    eachRepeatedCard(cards, func) {
        for (let cardEntry of cards) {
            for (var i = 0; i < cardEntry.count; i++) {
                func(cardEntry.card);
            }
        }
    }

    createCardForType(baseClass, player, cardData) {
        let cardClass = cards[cardData.code] || baseClass;
        if (cardClass.cardData) {
            cardData = Object.assign({}, cardData, cardClass.cardData);
        }
        let card = new cardClass(player, cardData);
        card.version = cardClass.version;
        return card;
    }

    createCard(player, cardData) {
        if (this.isDrawCard(cardData)) {
            var drawCard = this.createCardForType(DrawCard, player, cardData);
            drawCard.moveTo('draw deck');
            return drawCard;
        }

        if (this.isPlotCard(cardData)) {
            var plotCard = this.createCardForType(PlotCard, player, cardData);
            plotCard.moveTo('plot deck');
            return plotCard;
        }
    }
}

export default Deck;
