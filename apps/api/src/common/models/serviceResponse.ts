import { StatusCodes } from "http-status-codes";
import { z } from "zod";

/**
 * The boilerplate's envelope, extended with two fields doc 03 §A4 requires:
 *   `code`      — machine-readable. THE CONTRACT. Clients switch on this.
 *   `requestId` — attached at send time by handleServiceResponse().
 * `message` is for humans and may change freely.
 */
export class ServiceResponse<T = null> {
	readonly success: boolean;
	readonly message: string;
	readonly responseObject: T;
	readonly statusCode: number;
	readonly code?: string;
	readonly requestId?: string;

	private constructor(
		success: boolean,
		message: string,
		responseObject: T,
		statusCode: number,
		code?: string,
		requestId?: string,
	) {
		this.success = success;
		this.message = message;
		this.responseObject = responseObject;
		this.statusCode = statusCode;
		this.code = code;
		this.requestId = requestId;
	}

	static success<T>(message: string, responseObject: T, statusCode: number = StatusCodes.OK) {
		return new ServiceResponse(true, message, responseObject, statusCode);
	}

	static failure<T>(message: string, responseObject: T, statusCode: number = StatusCodes.BAD_REQUEST, code?: string) {
		return new ServiceResponse(false, message, responseObject, statusCode, code);
	}

	withRequestId(requestId: string): ServiceResponse<T> {
		return new ServiceResponse(this.success, this.message, this.responseObject, this.statusCode, this.code, requestId);
	}
}

export const ServiceResponseSchema = <T extends z.ZodTypeAny>(dataSchema: T) =>
	z.object({
		success: z.boolean(),
		message: z.string(),
		responseObject: dataSchema.optional(),
		statusCode: z.number(),
		code: z.string().optional(),
		requestId: z.string().optional(),
	});
