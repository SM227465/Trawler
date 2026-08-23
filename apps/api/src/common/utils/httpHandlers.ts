import type { NextFunction, Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import type { ZodError, ZodSchema } from "zod";

import { ServiceResponse } from "@/common/models/serviceResponse";

/** Single exit point for every controller. Attaches the requestId. */
export const handleServiceResponse = (serviceResponse: ServiceResponse<unknown>, res: Response) => {
	const withId = serviceResponse.withRequestId(res.locals.requestId as string);
	res.status(withId.statusCode).send(withId);
};

export const validateRequest = (schema: ZodSchema) => async (req: Request, res: Response, next: NextFunction) => {
	try {
		await schema.parseAsync({ body: req.body, query: req.query, params: req.params });
		next();
	} catch (err) {
		const errors = (err as ZodError).errors.map((e) => {
			const fieldPath = e.path.length > 0 ? e.path.join(".") : "root";
			return `${fieldPath}: ${e.message}`;
		});

		const errorMessage =
			errors.length === 1
				? `Invalid input: ${errors[0]}`
				: `Invalid input (${errors.length} errors): ${errors.join("; ")}`;

		handleServiceResponse(
			ServiceResponse.failure(errorMessage, null, StatusCodes.BAD_REQUEST, "VALIDATION_ERROR"),
			res,
		);
	}
};
