ALTER TABLE chat_messages
	ADD COLUMN client_message_id uuid;

CREATE UNIQUE INDEX idx_chat_messages_chat_client_message_id
	ON chat_messages (chat_id, client_message_id)
	WHERE client_message_id IS NOT NULL AND deleted = false;

ALTER TABLE chat_queued_messages
	ADD COLUMN client_message_id uuid;

CREATE UNIQUE INDEX idx_chat_queued_messages_chat_client_message_id
	ON chat_queued_messages (chat_id, client_message_id)
	WHERE client_message_id IS NOT NULL;
