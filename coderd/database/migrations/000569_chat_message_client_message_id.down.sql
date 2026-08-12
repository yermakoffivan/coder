DROP INDEX idx_chat_queued_messages_chat_client_message_id;

ALTER TABLE chat_queued_messages
	DROP COLUMN client_message_id;

DROP INDEX idx_chat_messages_chat_client_message_id;

ALTER TABLE chat_messages
	DROP COLUMN client_message_id;
