-- CreateIndex
CREATE UNIQUE INDEX "ScheduleSlot_userId_weekday_key" ON "ScheduleSlot"("userId", "weekday");
