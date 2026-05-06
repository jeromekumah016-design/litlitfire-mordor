CREATE TABLE `retryHistory` (
	`id` int AUTO_INCREMENT NOT NULL,
	`pageId` int NOT NULL,
	`bookId` int NOT NULL,
	`attemptNumber` int NOT NULL,
	`status` enum('pending','processing','success','failed') NOT NULL DEFAULT 'pending',
	`errorMessage` text,
	`retryReason` varchar(255),
	`backoffDelayMs` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`completedAt` timestamp,
	CONSTRAINT `retryHistory_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `pages` ADD `retryCount` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `pages` ADD `maxRetries` int DEFAULT 3 NOT NULL;--> statement-breakpoint
ALTER TABLE `pages` ADD `lastRetryAt` timestamp;--> statement-breakpoint
ALTER TABLE `pages` ADD `nextRetryAt` timestamp;--> statement-breakpoint
CREATE INDEX `pageIdIdx` ON `retryHistory` (`pageId`);--> statement-breakpoint
CREATE INDEX `bookIdIdx` ON `retryHistory` (`bookId`);--> statement-breakpoint
CREATE INDEX `statusIdx` ON `retryHistory` (`status`);