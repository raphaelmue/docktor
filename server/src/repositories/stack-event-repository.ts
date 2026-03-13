import {prisma} from "../lib/db.js"
import type {StackEventType} from "../generated/prisma/enums.js"

export interface CreateStackEventInput {
    stackId: string
    type: StackEventType
    message?: string
    payload?: string // JSON string
}

export class StackEventRepository {
    async createEvent(input: CreateStackEventInput) {
        return prisma.stackEvent.create({data: input})
    }

    async findRecentByStack(stackId: string, limit = 20) {
        return prisma.stackEvent.findMany({
            where: {stackId},
            orderBy: {createdAt: "desc"},
            take: limit,
        })
    }
}

export const stackEventRepository = new StackEventRepository()
