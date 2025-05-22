import React from 'react';
import { Button, Modal, ModalBody, ModalContent, ModalHeader } from '@nextui-org/react';
import { useGetStarterDecksQuery } from '../../redux/middleware/api';
import LoadingSpinner from '../Site/LoadingSpinner';

const SelectDeckModal = ({ onClose, onDeckSelected, side }) => {
    //  const standaloneDecks = useSelector((state) => state.cards.standaloneDecks);
    const { data: decks, isLoading } = useGetStarterDecksQuery(side);

    return (
        <>
            <Modal isOpen={true} onClose={onClose} size='5xl'>
                <ModalContent>
                    <ModalHeader>{'Select Deck'}</ModalHeader>
                    <ModalBody>
                        {isLoading ? (
                            <LoadingSpinner label={'Loading decks...'} />
                        ) : (
                            <div>
                                <h4 className='deck-list-header'>Choose a starter deck</h4>
                                {decks.map((deck) => (
                                    <Button
                                        color='primary'
                                        key={deck._id}
                                        onClick={() => onDeckSelected(deck)}
                                    >
                                        {deck.name}
                                    </Button>
                                ))}
                            </div>
                        )}
                    </ModalBody>
                </ModalContent>
            </Modal>
        </>
    );
};

export default SelectDeckModal;
