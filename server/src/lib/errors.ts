export class AppError extends Error {
    constructor(
        message: string,
        public statusCode: number = 500,
    ) {
        super(message);
        this.name = this.constructor.name;
    }
}

export class NotFoundError extends AppError {
    constructor(message = "Not found") {
        super(message, 404);
    }
}

export class ConflictError extends AppError {
    constructor(message = "Conflict") {
        super(message, 409);
    }
}

export class BadRequestError extends AppError {
    constructor(message = "Bad request") {
        super(message, 400);
    }
}
